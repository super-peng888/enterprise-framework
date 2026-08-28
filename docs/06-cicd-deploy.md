# 06 · CI/CD 与生产发布架构

面向实施者的交付链路设计：代码托管（GitLab）→ 构建（Drone）→ 镜像仓库（Harbor）→ 编排部署（K8s）→ 观测（Alloy + Loki + Grafana）→ 金丝雀发布（Argo Rollouts）。

本文档只做架构约定，不含实施动作。涉及的 yaml 均为骨架示意，落地时按实际环境补全。

---

## 1. 总体链路

```
开发者
  │  git push / merge
  ▼
GitLab CE ────────── webhook ──────────┐
  (代码托管, MR 评审)                    │
                                       ▼
                                   Drone Server ── Runner (docker/k8s)
                                       │  触发方式：push / 手动 promote / 定时 cron
                                       │
                                       ├─ ① 后端构建：mvn package → framework-gateway/system jar
                                       ├─ ② 前端构建：pnpm build → dist
                                       ├─ ③ 镜像构建：kaniko 无守护进程构建 3 个镜像
                                       ▼
                                   Harbor（自建镜像仓库，Trivy 扫描）
                                       │  imagePullSecret
                                       ▼
                                   K8s 集群
                                       ├─ dev：push main 自动部署
                                       ├─ prod：Drone promote 手动触发
                                       │        └─ Argo Rollouts 金丝雀（10% → 人工确认 → 50% → 100%）
                                       ▼
                                   ALG 观测面
                                       Alloy(DaemonSet) → Loki → Grafana(面板/告警 → 飞书 webhook)
```

设计要点：

- **Drone 只做 CI + 触发部署**（push 模型：pipeline 末尾 `kubectl` / `argo rollouts` 直接作用于集群）。不引入 Argo CD 等 GitOps 组件，保持链路短；后续仓库与环境增多再演进。
- **一键回退 = 旧镜像 tag 重新部署**。Harbor 保留历史 tag，回滚不走流水线重建。
- **中间件不进发布流水线**。Postgres/Redis/RabbitMQ/Nacos 属基础设施，独立运维（见 §5.4）。

---

## 2. 组件选型与部署形态

| 组件 | 形态 | 资源量级 | 说明 |
| --- | --- | --- | --- |
| GitLab CE | docker compose 单机（或 helm 入 k8s） | ≥ 4C8G，常驻 ~2.5G 内存 | 首次启动 5-10 分钟；开启 container registry 不必（镜像归 Harbor） |
| Drone Server + Runner | docker compose 与 GitLab 同机 | 轻量 | runner 选 docker-runner 起步；构建负载上来后换 k8s runner |
| Harbor | docker compose 独立部署 | ≥ 2C4G + 磁盘（镜像 ~1-2G/套） | 启用 Trivy 漏洞扫描；对接域名 + HTTPS（内网可自签，k8s 侧配 insecure-registry 或分发 CA） |
| K8s | 既有集群或 k3s 起步 | — | dev/prod 分 namespace 隔离（§5.1） |
| Argo Rollouts | k8s CRD 控制器 | 轻量 | 金丝雀发布控制器（§6） |
| ALG | Alloy DaemonSet + Loki（monolithic 起步）+ Grafana | Loki 磁盘按保留期估算 | 日志链路（§7）；指标用 kube-prometheus-stack（与 Grafana 同栈，供金丝雀分析） |

Drone 与 GitLab 对接：GitLab 建 OAuth Application，Drone server 配置 `DRONE_GITLAB_CLIENT_ID/SECRET`，repo 激活后自动注册 webhook。

---

## 3. 镜像规划与 tag 策略

Harbor 项目 `ef`，三个镜像：

| 镜像 | 基础镜像 | 内容 |
| --- | --- | --- |
| `harbor.<域>/ef/framework-gateway` | `eclipse-temurin:21-jre` | gateway jar（分层构建见 §4.3） |
| `harbor.<域>/ef/framework-system` | `eclipse-temurin:21-jre` | system jar |
| `harbor.<域>/ef/framework-frontend` | `nginx:1.27-alpine` | 前端 dist + nginx conf（含 `/api` 反代 gateway、屏蔽 `/api/*/internal/**` 外放，见 `docs/01-architecture.md` §2） |

tag 规则：`<版本>-<git短sha>`（如 `1.0.0-a1b2c3d`），每个 commit 唯一、可回溯；`dev` 环境追加 `latest-dev` 浮动 tag 方便调试。**禁止对 prod 使用浮动 tag**，prod 部署清单里永远是具体 tag。

Harbor 侧配置：

- Robot account：`robot$drone`（push/pull 权限，供 Drone 使用）；k8s 集群用独立只读 robot 生成 `imagePullSecret`。
- 保留策略：每镜像保留最近 20 个 tag，`*-dev` 保留最近 5 个。
- Trivy 扫描：push 后自动扫描，High/Critical 漏洞在 Harbor 面板可见（不阻断，纳入发布 checklist）。

---

## 4. Drone 流水线设计

### 4.1 触发矩阵

| 触发方式 | 目标 | 动作 |
| --- | --- | --- |
| push 到 `main` | dev | 构建 → 推送镜像 → 自动部署 dev namespace |
| Drone Promotion（UI/`drone build promote`） | staging/prod | 同一 commit 的镜像重新打 tag（或复用）→ 金丝雀发布 |
| cron（如 `nightly`） | dev | 定时全量构建，保证流水线常绿、基础镜像 CVE 早发现 |

生产发布永远走 promote（人工门禁），不由 push 自动触发。

### 4.2 `.drone.yml`（完整版）

四个 pipeline：`build-backend` / `build-frontend` / `deploy-dev` / `deploy-prod`。

```yaml
# ============ 后端：打包 + 构建推送 gateway/system 两个镜像 ============
kind: pipeline
type: docker
name: build-backend

trigger:
  branch: [main]
  event: [push, cron, promote]     # promote 也要能跑到（prod 发布复用同一 commit 的构建）

steps:
  - name: maven-package
    image: maven:3.9-eclipse-temurin-21
    volumes: [{ name: m2, path: /root/.m2 }]
    commands:
      - cd backend
      - mvn -q -B package           # 测试失败即终止；稳定后可 -DskipTests 提速

  - name: image-gateway
    image: plugins/kaniko           # 无 docker-in-docker，直接构建并推送
    settings:
      registry: harbor.<域>
      repo: ef/framework-gateway
      tags: ["1.0.0-${DRONE_COMMIT_SHA:0:7}"]
      context: backend/framework-gateway       # 构建上下文=模块目录，jar 已在 target/
      dockerfile: backend/framework-gateway/Dockerfile
      username: { from_secret: harbor_user }
      password: { from_secret: harbor_pass }
      # Harbor 自签 http 时加 insecure: true
    depends_on: [maven-package]

  - name: image-system
    image: plugins/kaniko
    settings:
      registry: harbor.<域>
      repo: ef/framework-system
      tags: ["1.0.0-${DRONE_COMMIT_SHA:0:7}"]
      context: backend/framework-system
      dockerfile: backend/framework-system/Dockerfile
      username: { from_secret: harbor_user }
      password: { from_secret: harbor_pass }
    depends_on: [maven-package]

volumes:
  - name: m2
    host: { path: /opt/drone-cache/m2 }   # 宿主机卷缓存，repo 必须在 Drone 设为 trusted 才生效
---
# ============ 前端：pnpm build + nginx 镜像 ============
kind: pipeline
type: docker
name: build-frontend

trigger:
  branch: [main]
  event: [push, cron, promote]

steps:
  - name: pnpm-build
    image: node:22-alpine
    volumes: [{ name: pnpm-store, path: /root/.local/share/pnpm/store }]
    commands:
      - corepack enable
      - cd frontend
      - pnpm install --frozen-lockfile
      - pnpm build                  # 产物 frontend/dist

  - name: image-frontend
    image: plugins/kaniko
    settings:
      registry: harbor.<域>
      repo: ef/framework-frontend
      tags: ["1.0.0-${DRONE_COMMIT_SHA:0:7}"]
      context: frontend             # Dockerfile 里 COPY dist/ + nginx conf
      dockerfile: frontend/Dockerfile
      username: { from_secret: harbor_user }
      password: { from_secret: harbor_pass }
    depends_on: [pnpm-build]

volumes:
  - name: pnpm-store
    host: { path: /opt/drone-cache/pnpm }
---
# ============ dev：push/cron 自动部署 ============
kind: pipeline
type: docker
name: deploy-dev
depends_on: [build-backend, build-frontend]

trigger:
  branch: [main]
  event: [push, cron]

steps:
  - name: kubectl
    image: bitnami/kubectl:1.31
    environment:
      KUBECONFIG_B64: { from_secret: kubeconfig_dev }
      TAG: "1.0.0-${DRONE_COMMIT_SHA:0:7}"
    commands:
      - echo "$KUBECONFIG_B64" | base64 -d > /tmp/kubeconfig
      - export KUBECONFIG=/tmp/kubeconfig
      - kubectl -n ef-dev set image deploy/framework-gateway  gateway=harbor.<域>/ef/framework-gateway:$TAG
      - kubectl -n ef-dev set image deploy/framework-system   system=harbor.<域>/ef/framework-system:$TAG
      - kubectl -n ef-dev set image deploy/framework-frontend nginx=harbor.<域>/ef/framework-frontend:$TAG
      - kubectl -n ef-dev rollout status deploy/framework-gateway  --timeout=180s
      - kubectl -n ef-dev rollout status deploy/framework-system   --timeout=180s
      - kubectl -n ef-dev rollout status deploy/framework-frontend --timeout=180s
---
# ============ prod：promote 手动触发，金丝雀 ============
kind: pipeline
type: docker
name: deploy-prod
depends_on: [build-backend, build-frontend]

trigger:
  target: [prod]
  event: [promote]

steps:
  - name: canary
    image: bitnami/kubectl:1.31
    environment:
      KUBECONFIG_B64: { from_secret: kubeconfig_prod }
      TAG: "1.0.0-${DRONE_COMMIT_SHA:0:7}"
    commands:
      - echo "$KUBECONFIG_B64" | base64 -d > /tmp/kubeconfig
      - export KUBECONFIG=/tmp/kubeconfig
      # Rollout 对象：只更新镜像，金丝雀步骤由 Argo Rollouts 控制器执行
      - kubectl -n ef-prod set image rollout/framework-gateway gateway=harbor.<域>/ef/framework-gateway:$TAG
      - kubectl -n ef-prod set image rollout/framework-system  system=harbor.<域>/ef/framework-system:$TAG
      # 前端静态资源无需金丝雀，滚动更新并等待完成
      - kubectl -n ef-prod set image deploy/framework-frontend nginx=harbor.<域>/ef/framework-frontend:$TAG
      - kubectl -n ef-prod rollout status deploy/framework-frontend --timeout=180s
      # 注意：这里不 watch Rollout。金丝雀会在 pause 点停住等待人工确认：
      #   kubectl argo rollouts promote framework-gateway -n ef-prod
      # AnalysisTemplate 指标不达标会自动回滚，无需人工干预。
```

### 4.2.1 部署 step 的机制（kubectl 如何"自动"部署）

1. **凭证准备（一次性）**：k8s 里给 Drone 建最小权限 SA（只允许对应 namespace 的 deployments/rollouts 写），签 token 生成 kubeconfig，base64 后存 Drone secret：
   ```bash
   drone secret add --repository <组/enterprise-framework> --name kubeconfig_dev  --data "$(base64 -w0 kubeconfig-dev.yaml)"
   drone secret add --repository <组/enterprise-framework> --name kubeconfig_prod --data "$(base64 -w0 kubeconfig-prod.yaml)"
   drone secret add --repository <组/enterprise-framework> --name harbor_user --data 'robot$drone'
   drone secret add --repository <组/enterprise-framework> --name harbor_pass --data '<robot-token>'
   ```
2. **首次引导（一次性，手工）**：`kubectl apply -f deploy/k8s/` 建好 namespace/Deployment/Rollout/Service/Ingress/ConfigMap/Secret；此后流水线只改 image tag。
3. **每次发布的动作 = `set image` + `rollout status`**：`set image` 改 Pod 模板触发滚动更新；`rollout status` 阻塞等待新版本就绪探针通过——新版本起不来（探针失败、镜像拉不到）时 kubectl 非零退出，**pipeline 变红即部署失败**，旧版本 Pod 仍在服务，天然安全。
4. **tag 一致性**：`${DRONE_COMMIT_SHA:0:7}` 在同一次构建的所有 pipeline 中是同一个值，build 推的镜像 tag 与 deploy 拉的 tag 必然一致；promote 基于某个已成功的 build 发起，commit 不变。
5. **promote 操作**：Drone UI 上对已成功的 build 点「Promote」选 `prod` 环境，或 CLI `drone build promote <组/仓库> <build号> prod`。只有 `trigger.event=promote + target=prod` 的 pipeline 会跑。
6. **prod 不等待 rollout 完成**：金丝雀的 pause 是设计内的人工门禁，pipeline 把镜像交给 Rollouts 控制器即结束（绿）；后续人工 promote / 自动回滚发生在集群侧，由 ALG 观测。

要点：

- **构建一次，多处部署**：镜像在 build pipeline 产出，deploy 只改 image tag，不重新构建。
- 宿主机卷缓存（m2/pnpm-store）要求 repo 在 Drone 中设为 **trusted**（仓库 Settings 或 `drone repo update --trusted`），否则 host volume 被静默忽略。
- cron 在 Drone UI/CLI 配 `drone cron add <repo> main nightly "0 18 * * *"`。

### 4.3 后端 Dockerfile 约定（骨架）

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
# 依赖层与应用层分离，充分利用镜像层缓存
ARG JAR_FILE=target/framework-system-1.0.0.jar
COPY ${JAR_FILE} app.jar
ENV JAVA_OPTS="-Xms512m -Xmx1g"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

运行时环境变量（`NACOS_ADDR`/`REDIS_PASSWORD`/`RABBITMQ_*` 等，参照 `deploy/docker-compose.yml` 注释与 `deploy/nacos/*.yaml`）一律由 k8s ConfigMap/Secret 注入，镜像内不烘焙任何环境配置。

---

## 5. K8s 部署架构

### 5.1 布局

| 项 | dev | prod |
| --- | --- | --- |
| namespace | `ef-dev` | `ef-prod` |
| gateway | Deployment ×1 | **Rollout ×2**（金丝雀） |
| system | Deployment ×1 | **Rollout ×2**（金丝雀） |
| frontend(nginx) | Deployment ×1 | Deployment ×2（滚动即可，静态资源无需金丝雀） |
| 入口 | Ingress `ef-dev.<域>` | Ingress `ef.<域>` + canary 注解由 Rollouts 托管 |

每个 Pod 配 `resources.requests/limits`（起步：gateway/system 各 500m/1Gi request、1/2Gi limit）、`readinessProbe: /actuator/health/readiness`、`livenessProbe: /actuator/health/liveness`（两个服务已暴露 actuator 分组，见 `docs/01-architecture.md` §8）。

### 5.2 服务发现的关键决策（上 k8s 必须定）

当前 gateway → system 走 Nacos `lb://framework-system`（`deploy/nacos/framework-gateway.yaml`）。**k8s 内 Nacos 服务发现与 Service 语义重复，且会绕过 Rollouts 的流量切分**（gateway 直连 Nacos 实例列表，k8s Service 权重不生效）。

约定：

- **Nacos 只保留配置中心职能**（`framework-*.yaml` 配置照常用）。
- 服务间调用改为 k8s Service DNS：网关路由目标从 `lb://framework-system` 改为 `http://framework-system.<ns>.svc.cluster.local:8091`。
- 如此金丝雀权重在 ingress → gateway、gateway → system 两层都由 Rollouts/Service 正确接管。

具体改法（本项目只有 gateway → system 一处 HTTP 服务间调用，改动面很小）：

1. **路由 URI 参数化**（一份配置两套环境）：`deploy/nacos/framework-gateway.yaml` 的路由改为
   ```yaml
   routes:
     - id: framework-system
       uri: ${SYSTEM_URI:lb://framework-system}   # 缺省走 nacos lb，本地/dev 零改动
   ```
   k8s prod 在 gateway 的 ConfigMap 设 `SYSTEM_URI=http://framework-system.ef-prod.svc.cluster.local:8091`（同 namespace 可简写 `http://framework-system:8091`），无需为 prod 单独维护 Nacos 配置。
2. **k8s 建 Service**：`metadata.name: framework-system`、`selector.app: framework-system`、`port/targetPort: 8091`（用 Argo Rollouts 时稳定/金丝雀两个 Service 的 selector 由 Rollouts 接管）。DNS 名 `<service>.<namespace>.svc.cluster.local` 由 CoreDNS 解析。
3. **摘掉服务注册**（清理项，可后置）：路由无 `lb://` 后，gateway/system 的 `spring-cloud-starter-alibaba-nacos-discovery` 依赖可移除（`nacos-config` 保留）；过渡期不移 pom 就配 `spring.cloud.nacos.discovery.register-enabled: false`，避免 Pod 向 Nacos 注册无意义实例。
4. **验证**：`kubectl exec deploy/framework-gateway -- curl -s http://framework-system:8091/actuator/health` + `kubectl get endpoints framework-system`，再跑登录/审批主链路回归。

边界：gateway 金丝雀由 Rollouts + ingress-nginx 在入口层精确控权重；gateway → system 这层走 ClusterIP 时 `setWeight` 没有流量路由插件接管，只能按 **Pod 数量比例近似**（2 副本只有 50% 粒度）。推荐入口做精细金丝雀、system 粗粒度金丝雀或滚动更新；内层精细流量切分需 service mesh（Istio 等），本框架属过度设计，不引入。

### 5.2.1 新增业务服务时的服务间调用约定

框架已预留三条通道，新增服务（biz）直接套用，不引入新机制：

1. **入口侧（浏览器 → 新服务）**：网关 Nacos 配置加一条同款路由，URI 同样环境变量占位：
   ```yaml
   - id: framework-biz
     uri: ${BIZ_URI:lb://framework-biz}        # dev 走 Nacos，k8s 注入 Service DNS
     predicates: [Path=/api/biz/**]
     filters: [StripPrefix=2]
   ```
   JWT 鉴权、`X-User-*` 头注入、TraceId 由网关全局过滤器统一完成，新服务零感知。
2. **服务间同步调用（HTTP 内调）**：被调方开 `/internal/**` 接口（范例：`InternalApprovalController`、`InternalNotificationController`，无 JWT、SecurityConfig 放行）；调用方配置 `${SYSTEM_URI:lb://framework-system}` 式占位，dev 走 Nacos `lb://`，k8s 注入 Service DNS——所有调用关系共用这一条 URI 约定。客户端用裸 RestClient（k8s Service DNS 自带负载均衡，不上 Feign）；待办：`framework-common` 补一个 `InternalClient` 封装（baseUrl + 超时 + 自动透传 `X-User-Id`/`X-User-Name`/`X-Trace-Id`，取自 `UserContext`/`TraceIdHolder`），业务服务注入即用。k8s 里内调**直连 Service 不过网关**（少一跳、不受网关金丝雀影响），配套 NetworkPolicy 限集群内访问 + 共享内网令牌头（Secret 注入，`SecurityConfig.java` 注释已预留此意图）。
3. **服务间异步调用（MQ 事件）**：范例为 `approval.finished` 事件与 `NotificationSendListener`（不走 REST 的通知通道）。选型原则：要立刻拿结果/失败即报错的同步查询与命令走 HTTP 内调；事件通知、解耦、可重试的走 MQ，exchange/queue 沿用 `framework.*` 前缀规范。

用户上下文传递：调用方透传 `X-User-*` 头，下游依赖 `framework-common` 后由过滤器重建 `CurrentUser`（`JwtAuthFilter` 已示范信任头建 LoginUser），「人 = realName」的口径由 common 保证全链一致。

新服务接入 checklist：依赖 framework-common → 网关加路由 → 需要被调开 `/internal/**` → 需要通知发/收 MQ 事件 → URI 一律环境变量占位。

### 5.3 配置与凭证

- ConfigMap：Nacos 地址、日志级别等非密配置；Secret：DB/Redis/RabbitMQ 密码、JWT secret、`imagePullSecret`（Harbor 只读 robot）。
- Drone 侧 secrets：Harbor robot 账号、各环境 kubeconfig（**prod 用的 kubeconfig 绑定最小权限 SA**：只允许 `ef-prod` namespace 的 rollouts/deployments 写操作）。

### 5.4 中间件原则

Postgres/Redis/RabbitMQ/Nacos **外置**（独立主机或云产品），不进应用 namespace、不随发布变更。开发环境可继续复用本机 docker 容器（现状 `mcn-*`）。数据库变更（schema.sql 已有幂等机制，见 `docs/01-architecture.md` §8.2）随应用启动自动执行，不单独设 migration 流水线。

---

## 6. 金丝雀发布方案

### 6.1 选型：Argo Rollouts（推荐）

理由：权重切分 + 人工门禁 + 指标自动分析三件套齐全，比 ingress-nginx canary 注解（只有权重、无自动分析回滚）更适合生产。备选方案见 §6.4。

### 6.2 发布流程

```
Drone promote prod
  │
  ▼
kubectl apply Rollout（新 image tag）
  │
  ▼
Argo Rollouts 执行 canary steps：
  setWeight: 10      ── 10% 流量到新版本
  pause: {}          ── 人工门禁：观察 Grafana 面板/Loki 错误日志，
  │                     确认后 kubectl argo rollouts promote（或 Drone 二次 promote）
  setWeight: 50      ── 50% 流量
  pause: {duration: 300s}
  ▼
  全量 100%，旧 ReplicaSet 缩 0（保留一段窗口供快速回滚）
```

同时挂 AnalysisTemplate（后台自动判定，异常即自动回滚，不依赖人）：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: ef-success-rate }
spec:
  metrics:
    - name: error-rate
      interval: 30s
      failureLimit: 2                      # 连续 2 次不达标 → 自动回滚
      provider:
        prometheus:
          address: http://prometheus-operated.monitoring:9090
          query: |
            sum(rate(http_server_requests_seconds_count{namespace="ef-prod",status=~"5..",pod=~"{{args.canary-hash}}.*"}[2m]))
            /
            sum(rate(http_server_requests_seconds_count{namespace="ef-prod",pod=~"{{args.canary-hash}}.*"}[2m]))
      successCondition: result < 0.01      # 金丝雀实例 5xx 比例 < 1%
```

指标来源为 kube-prometheus-stack（Spring Boot actuator 暴露 `/actuator/prometheus`，由 ServiceMonitor 抓取）。日志侧异常（ERROR 突增、特定异常关键字）用 Loki 告警兜底（§7.3）。

### 6.3 回滚

- **金丝雀阶段**：AnalysisTemplate 失败自动回滚；或人工 `kubectl argo rollouts abort`。
- **全量后发现缺陷**：`kubectl argo rollouts undo`（回上一 ReplicaSet，秒级）；镜像层回退 = `kubectl set image` 指定 Harbor 里的旧 tag。
- 数据库 schema 变更要求**向后兼容**（只增不删、新列可空），保证任意版本回滚安全——这是对 schema.sql 演进的硬约束。

### 6.4 备选：ingress-nginx canary（轻量简化版）

不引入 Rollouts CRD 时：prod 另建 `framework-gateway-canary` Deployment + canary Ingress（`nginx.ingress.kubernetes.io/canary-weight: "10"`），权重人工调整、观察后切全量。无自动分析回滚，适合集群不便装 CRD 的过渡期。

---

## 7. ALG 日志监控

### 7.1 采集链路

```
Pod stdout/stderr
  │  （应用已输出结构化日志；TraceId 由网关 TraceIdGlobalFilter 全链路透传，
  │      见 docs/01-architecture.md §2，排查时按 X-Trace-Id 串全链）
  ▼
Grafana Alloy（DaemonSet，每节点一份）
  loki.source.kubernetes 发现同节点 Pod 日志 → 附加 namespace/pod/container/app 标签
  │  push
  ▼
Loki（monolithic 单实例起步，PVC 存储；量上来后拆 SimpleScalable + MinIO/S3）
  ▼
Grafana：Explore 查询 + 预置仪表盘 + 告警
```

标签纪律（Loki 高基数是头号坑）：只打 `namespace/app/pod/container` 这类低基数标签；**traceId、userId 不进标签**，留在日志正文用 `|~ "traceId=xxx"` 过滤。

### 7.2 Alloy 配置骨架（river 语法）

```river
discovery.kubernetes "pods" { role = "pod" }
loki.source.kubernetes "pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [loki.process.labels.receiver]
}
loki.process "labels" {
  stage.static_labels { values = { cluster = "prod" } }
  forward_to = [loki.write.default.receiver]
}
loki.write "default" { endpoint { url = "http://loki.monitoring:3100/loki/api/v1/push" } }
```

实际部署直接用 helm `grafana/alloy` + `grafana/loki` + `grafana/grafana` chart，values 里对接即可，不必手写清单。

### 7.3 保留与告警

- Loki 保留期：dev 7 天 / prod 30 天（`limits_config.retention_period` + compactor 删除）。
- Grafana 预置面板：请求量/错误率/延迟（Prometheus）、ERROR 日志流、按 traceId 查全链日志的入口面板。
- 告警（Loki ruler → Alertmanager）：ERROR 日志速率突增（如 5m > 50 条）、`OutOfMemoryError` 关键字、审批引擎 MQ 消费失败。通知渠道接**飞书群机器人 webhook**（与登录体系同生态）。

### 7.4 后续扩展（本期不做）

Tempo 接链路追踪（ALG → ALGT）、Loki 日志做金丝雀分析的 datasource（Rollouts 支持 web metric 自研适配）。

---

## 8. 分期实施路线

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 1. 代码上库 | 部署 GitLab CE；`enterprise-framework` git init、`.gitignore` 梳理（`.env`/`logs/`/target/dist/node_modules）、推 main；分支保护 + MR 评审规则 | 仓库可 clone，main 受保护 |
| 2. CI 打通 | Drone 部署对接 GitLab；编写 `.drone.yml` + 3 个 Dockerfile；部署 Harbor；构建 → 推送全链路 | push main 后 Harbor 出现对应 sha 镜像 |
| 3. dev 上 k8s | dev namespace 清单（Deployment/Service/Ingress/ConfigMap/Secret/imagePullSecret）；路由改 Service DNS（§5.2）；deploy pipeline 自动部署 dev | `ef-dev.<域>` 可用，发版全自动 |
| 4. ALG | helm 部署 alloy/loki/grafana + kube-prometheus-stack；预置面板与飞书告警 | Grafana 可查到全量 Pod 日志，告警触达飞书 |
| 5. 金丝雀上线 | prod namespace + Argo Rollouts + AnalysisTemplate；promote 门禁演练；回滚演练 | 一次完整的 10%→人工→全量发布 + 一次回滚演练通过 |

阶段间无强耦合，2 可与 4 并行。

---

## 9. 风险与注意点

- **GitLab 资源重**：与 Drone 同机部署时机器至少 8G 可用内存；紧张则 GitLab 用外部已有实例，Drone 自部署即可。
- **单机 docker runner 的构建隔离**：`.m2`/`node_modules` 缓存放宿主机卷，注意磁盘水位； kaniko 构建不产生 docker daemon 依赖。
- **生产 kubeconfig 权限**：Drone 里 prod 凭证泄露 = 生产失守，必须最小权限 SA + 只允许 promote 触发 prod pipeline（`trigger.event: promote`）。
- **金丝雀的数据库兼容**：见 §6.3，schema 演进只增不删，这是比发布工具更重要的纪律。
- **内部服务路由改造（§5.2）**：是 k8s 化的前置改动，影响网关路由配置，需在阶段 3 完成并在 dev 验证回归。
