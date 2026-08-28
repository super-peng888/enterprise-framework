# EF Admin 企业级管理框架

从业务项目中抽取的企业后台底座：**认证、RBAC、@DataScope 数据权限、审计、审批引擎（JSON Schema 表单 + 卡片式流程设计）、通知中心**。
定位为**单租户 + RBAC + 数据权限**：全库数据共享，行级数据可见性由角色 `data_scope` 五档控制。
业务系统在其上只做业务表与业务接口，平台能力全部复用本框架。

## 能力总览

| 域 | 能力 |
| --- | --- |
| 认证 | 账号密码登录（BCrypt，支持用户名或真实姓名）、飞书扫码占位、JWT + 网关统一鉴权 |
| RBAC | 用户/角色/菜单三级；权限点（`module:resource:action`）管按钮与 API，菜单驱动页面可见性 |
| 数据权限 | `@DataScope` 五档：全部 / 本部门及以下 / 本部门 / 仅本人 / 自定义部门集合 |
| 动态路由 | 菜单存组件地址，前端 `import.meta.glob` 动态装配——新增页面放组件 + 配菜单即上线 |
| 审批 | 表单中心（拖拽设计器 + 栅格布局 + 接口数据源）、流程设计器（React Flow 画布 + 条件分支 + 汇合总线）、引擎（或签/会签/前后加签/驳回四去向+重新提交/抄送/流程版本快照） |
| 表格 | 自研 DataTable：自研排序（三态循环）、列宽拖拽、列序拖拽、列筛选、列设置持久化、悬浮搜索条、右键菜单、全屏 |
| 主题 | 浅色/深色双主题 + 筑梦黑字体 + 彩色 pastel chip |

## 技术栈

- **后端**：Java 21、Spring Boot 4.1.0、Spring Cloud 2025.1.2、SCA 2025.1.0.0（Nacos 3.x 注册+配置）、jjwt 0.13、PostgreSQL 16、Redis 7、RabbitMQ 3.13
- **前端**：React 18、TypeScript、Vite 7、antd 6.6、zustand、lucide-react、@xyflow/react 12、ECharts

## 目录结构

```
enterprise-framework/
├── backend/                    # Maven 多模块（com.framework）
│   ├── framework-common/       # Result/分页/@AuditLog/@DataScope/JwtUtils/上下文
│   ├── framework-gateway/      # API 网关 8090：JWT 鉴权、用户头注入、TraceId、CORS
│   └── framework-system/       # 系统服务 8091：认证/RBAC/审计/审批引擎/通知/内调
├── frontend/                   # ef-admin（React + antd 6）
│   └── src/
│       ├── components/         # DataTable / FormModal / SchemaForm / NotificationBell
│       ├── layouts/            # MainLayout（灰底 + 白圆角 body 卡 + 透明侧边栏）
│       ├── pages/              # dashboard / system(RBAC) / approval(审批全家桶)
│       ├── router/             # 动态路由装配（registry/glob/RequireAuth/RouteFallback）
│       ├── stores/             # auth / menu / theme（zustand + persist）
│       ├── styles/             # global.css / themes.css / fonts.css（筑梦黑）
│       └── assets/fonts/       # DreamHanSansCN W7/W14
├── deploy/
│   ├── docker-compose.yml      # 中间件复用说明
│   └── nacos/                  # 配置中心文本（framework-*.yaml）
└── docs/                       # 分册文档（见下）
```

## 快速开始

```bash
# 1. 建库（一次性）
docker exec mcn-postgres psql -U postgres -c "CREATE DATABASE ef;"

# 2. 发布 Nacos 配置（Git Bash 中文 body 用 --data-urlencode content@文件）
cd deploy/nacos
for f in framework-gateway framework-system; do
  curl -s -X POST 'http://localhost:18848/nacos/v3/admin/cs/config' \
    --data-urlencode "dataId=${f}.yaml" --data-urlencode 'groupName=DEFAULT_GROUP' \
    --data-urlencode 'type=yaml' --data-urlencode "content@${f}.yaml"
done

# 3. 后端（JDK 21；中间件复用 mcn-postgres/mcn-redis/mcn-rabbitmq/mcn-nacos-verify）
cd backend && mvn -DskipTests clean package
NACOS_ADDR=localhost:18848 REDIS_PASSWORD=mcn_redis_123 RABBITMQ_USER=mcn RABBITMQ_PASS=mcn123456 \
  java -jar framework-gateway/target/framework-gateway-1.0.0.jar &
NACOS_ADDR=localhost:18848 REDIS_PASSWORD=mcn_redis_123 RABBITMQ_USER=mcn RABBITMQ_PASS=mcn123456 \
  java -jar framework-system/target/framework-system-1.0.0.jar &

# 4. 前端
cd frontend && pnpm install && pnpm dev   # http://localhost:5175
```

默认账号（密码均 `123456`）：`admin`（平台超管）、`zhangsan`（部门负责人）、`lisi`（普通员工，仅本人数据）。

> 中间件复用说明：PG 用独立库 `ef`；Redis 密码 `mcn_redis_123`；RabbitMQ `mcn/mcn123456`；Nacos 在 18848（dataId `framework-*.yaml`）。

## 文档分册

| 文档 | 内容 |
| --- | --- |
| [docs/01-architecture.md](docs/01-architecture.md) | 后端架构：模块、安全链路、RBAC、审计、审批引擎、通知、部署 |
| [docs/02-frontend.md](docs/02-frontend.md) | 前端架构：主题/字体、布局、动态路由、状态管理、mock 降级模式 |
| [docs/03-components.md](docs/03-components.md) | DataTable 完整 API、FormModal、SchemaForm 用法与配置项 |
| [docs/04-approval.md](docs/04-approval.md) | 审批体系：表单中心、流程设计器、引擎语义（加签/驳回/抄送/快照） |
| [docs/05-rbac-datascope.md](docs/05-rbac-datascope.md) | RBAC 表结构、权限点约定、@DataScope 数据权限接入方法 |
| [docs/06-cicd-deploy.md](docs/06-cicd-deploy.md) | CI/CD 与生产发布：GitLab+Drone+Harbor+K8s、ALG 日志监控、金丝雀发布方案 |

## 业务方接入方式

1. 建业务表 + CRUD（业务服务走网关 `/api/<service>/**` 静态路由或注册进 Nacos）。
2. 需要审批：在「表单中心」配表单 →「流程设计」配流程并关联表单 → 业务侧调 `POST /internal/approval/instances` 发起（参考请假示例 LEAVE）。
3. 需要数据范围：业务表加 `owner_id` / `dept_id`，查询方法上加 `@DataScope`。
4. 需要权限点：菜单管理里加按钮型权限码，前端按钮按 `perms` 显隐，后端 `@PreAuthorize` 校验。
