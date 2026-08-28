# 01 · 后端架构

面向接手者的后端全景说明。所有结论均以代码为准，引用处给出文件路径（相对 `backend/` 根）。

技术基线（`backend/pom.xml`）：Java 21、Spring Boot 4.1.0、Spring Cloud 2025.1.2、Spring Cloud Alibaba 2025.1.0.0（Nacos 注册 + 配置）、jjwt 0.13.0、PostgreSQL 16、Redis 7、RabbitMQ 3.13。

---

## 1. 模块划分与依赖关系

`backend/pom.xml` 是 packaging=pom 的父工程（`com.framework:enterprise-framework:1.0.0`），三个子模块：

| 模块 | 端口 | 定位 | 关键依赖 |
| --- | --- | --- | --- |
| `framework-common` | — | 纯契约/工具包：统一返回 `Result`/`PageResult`、注解 `@AuditLog`/`@DataScope`、上下文 `UserContext`/`DataScopeContext`/`TraceIdHolder`、JWT 校验工具 `JwtUtils`、常量 `Constants`、错误码 `ErrorCode` | 无 Spring Web，不跑服务 |
| `framework-gateway` | 8090 | API 网关（Spring Cloud Gateway / WebFlux）：TraceId、统一 JWT 鉴权、用户头注入、CORS | 依赖 common；**不引 Spring Security**，用 `JwtUtils` 手工验签 |
| `framework-system` | 8091 | 系统服务（Spring MVC + Spring Security + Spring Data JPA）：认证、RBAC、审计、审批引擎、通知中心、内调接口 | 依赖 common |

拆分理由：

- **common 是"契约层"**。网关注入的 `X-User-Id`/`X-User-Name` 头名、JWT claims 口径（`sub`/`uid`/`realName`）、HS256 密钥格式由 `Constants`/`JwtUtils`（`framework-common/src/main/java/com/framework/common/constant/Constants.java`、`.../security/JwtUtils.java`）统一定义，gateway 校验、system 信任，两边不会漂移。后续新增业务服务（biz）同样只依赖 common 就能接入这套约定。
- **gateway 只做边缘鉴权**，不查库、不加载 Spring Security，保持 WebFlux 轻量；验签失败直接短路返回，非法请求不打到下游。
- **system 承载全部平台能力**，业务服务未来复用它的认证结果（网关头）、审批引擎（内调接口 + MQ 事件）、通知中心（内调接口 + MQ 事件），不需要再实现这些。

配置一律走 Nacos：两个服务的本地 `application.yml` 只有端口和 `optional:nacos:framework-*.yaml` 导入，业务配置（datasource/redis/rabbitmq/jwt/路由/CORS）在配置中心，文本存于 `deploy/nacos/framework-gateway.yaml`、`deploy/nacos/framework-system.yaml`。

---

## 2. 请求安全链路

浏览器 → gateway（8090）→ system（8091），链路如下：

```
浏览器
  │  Authorization: Bearer <jwt>
  ▼
framework-gateway
  ├─ TraceIdGlobalFilter（order=-100，framework-gateway/.../filter/TraceIdGlobalFilter.java）
  │    无 X-Trace-Id 则生成 UUID（去横线），写入下游请求头 + 响应头；
  │    记录 方法/路径/状态码/耗时 日志
  ├─ JwtAuthGlobalFilter（order=-90，framework-gateway/.../filter/JwtAuthGlobalFilter.java）
  │    ① 无条件剔除客户端伪造的 X-User-Id / X-User-Name（防头注入）
  │    ② 白名单直接放行：
  │       - /api/system/auth/login（登录接口本身）
  │       - /actuator/**（网关健康检查）
  │       - /api/*/internal/**（集群内调，不走公网鉴权；
  │         生产必须在 nginx 层屏蔽外放，代码注释指向 deploy/nginx/conf.d/framework.conf，
  │         注意该文件未随仓库提供，部署时需自行配置）
  │    ③ 非 /api/ 前缀也直接放行（已剔除伪造头）
  │    ④ 其余 /api/**：校验 Bearer token（HS256，与 system 同密钥，jwt.secret 配置）。
  │       失败 → 401，统一 JSON：{"code":401,"msg":"未认证或认证已过期"}（UTF-8）
  │       成功 → 向下游注入：
  │         X-User-Id:  <uid claim>
  │         X-User-Name: URL 编码的 realName（老 token 无 realName claim 时回退 username/sub）
  ▼  路由（deploy/nacos/framework-gateway.yaml）：Path=/api/system/** → StripPrefix=2 → lb://framework-system
framework-system
  ├─ JwtAuthFilter（framework-system/.../security/JwtAuthFilter.java）
  │    有 X-User-Id 头 → 直接信任，URLDecoder 解码 X-User-Name，
  │       建 LoginUser 放入 SecurityContext，同时写 UserContext
  │    无 → 直连场景兜底：自校验 Bearer token，同样建 LoginUser
  │    finally 中 TraceIdHolder.remove() + UserContext.remove()（防线程复用串号）
  └─ SecurityConfig（framework-system/.../config/SecurityConfig.java）
       无状态（STATELESS）、关 CSRF；permitAll：/auth/login、/actuator/health、/error、/internal/**
       其余一律 authenticated；未认证由 entryPoint 返回 401 JSON（{"code":401,...}）
       CORS 由网关 globalcors 统一处理，服务内不配
```

两个需要记住的要点：

- **「人」的口径统一为真实姓名**。JWT 带 `realName` claim，网关注入的 `X-User-Name` 是 realName（不是 username），审批任务 `assignee_name`、通知 `user_name` 全部按 realName 匹配。
- **X-User-* 头的信任边界在网关**。`JwtAuthFilter` 注释明确写了：绕过网关直连 8091 时客户端可伪造该头，生产环境服务端口必须只在内网可达（或改内网令牌/mTLS），公网只暴露网关 8090。网关侧先删后注入，保证头只能来自网关。

`UserContext`（`framework-common/.../context/UserContext.java`）是 ThreadLocal 的 `CurrentUser(id, username)`，审计切面等非 Web 层代码从这里取操作人；匿名/内调时 `get()` 返回 null。

---

## 3. 认证

### 3.1 账号密码登录

入口 `POST /auth/login`（`framework-system/.../controller/AuthController.java`），两种入参共用一个接口：

- 传 `{username, password}` → 账号密码分支 `loginByPassword`：
  1. `SysUserRepository.findByUsername` 查用户，查不到按真实姓名 `findByRealName` 兜底（演示环境友好，用户名全局唯一但姓名不唯一，姓名重复时 `findByRealName` 取第一条的语义需注意）；
  2. `BCryptPasswordEncoder.matches` 校验 `sys_user.password`（BCrypt 哈希；种子用户初始密码均为 `123456`，schema.sql 末尾只补空密码，幂等）；
  3. 用户不存在 / 密码错误 / 已禁用（`status != 1`）**统一返回 401「用户名或密码错误」**，不对外暴露具体原因；
  4. 成功签发 JWT，返回 `{token, tokenType:"Bearer"}`。
- 传 `{code}` → 飞书扫码分支（本期 mock 占位，见 3.3）。

成功/失败均通过 `LoginLogService.record`（`@Async`）落 `sys_login_log`（user_id、username、ip、user_agent、success、message）。客户端 IP 取 `X-Forwarded-For` 第一跳，否则 `getRemoteAddr()`。

### 3.2 JWT 结构

签发在 `framework-system/.../security/JwtService.java`：

- 算法 HS256，密钥 `jwt.secret`（要求 ≥32 字节，网关与 system 必须同一密钥；生产用 `JWT_SECRET` 环境变量注入）；
- claims：`sub` = username，`uid` = 用户 ID，`realName` = 真实姓名，另带 `iat`/`exp`；
- 有效期 `jwt.expire-minutes`，默认 720 分钟（12 小时），见 `deploy/nacos/framework-system.yaml`。

网关侧用 `framework-common/.../security/JwtUtils.java` 解析同一格式（只校验不签发），system 侧 `JwtAuthFilter` 兜底校验时也用 `JwtService.parse`。三处口径一致，改 claims 结构要三处一起改。

### 3.3 飞书扫码占位的设计意图

`AuthController` 的 code 分支当前是 mock：`code == "mock"` 时直接以种子用户 `admin` 签发 JWT，其他 code 记登录日志后返回「登录失败」。这不是偷懒，而是为真实扫码预留了全部骨架：

- `sys_user` 表已有 `feishu_union_id`（UNIQUE）、`feishu_open_id` 列（schema.sql）；
- `deploy/nacos/framework-system.yaml` 有 `feishu.app-id/app-secret/redirect-uri` 占位配置（对应 `config/FeishuProperties.java`）；
- `SysUserRepository.findByFeishuUnionId` 查询方法已就位。

接真实飞书时的改动点只有一处：把 code 分支替换为「code 换飞书 access_token → 取 union_id → `findByFeishuUnionId` 找/建用户 → 签发 JWT」。

---

## 4. RBAC 实现

表结构（`framework-system/src/main/resources/schema.sql`）：

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `sys_user` | 用户 | `username` 唯一、`real_name`、`password`（BCrypt）、`dept_id`、`status`（1 在职/0 禁用）、飞书两列 |
| `sys_role` | 角色 | `code` 唯一、`name`、`data_scope`（五档数据范围，默认 SELF）、`dept_ids` jsonb（CUSTOM 档自定义部门） |
| `sys_user_role` | 用户-角色 | 复合主键 (user_id, role_id) |
| `sys_menu` | 菜单/权限点 | `parent_id`、`title`、`type`（dir/menu/button）、`path`（前端组件地址）、`icon`、`perm`（权限点串）、`sort` |
| `sys_role_menu` | 角色-菜单 | 复合主键 (role_id, menu_id) |
| `sys_dept` | 部门 | `parent_id`（0 为根）、`name`、`feishu_dept_id` |

权限点串约定 `module:resource:action`，如种子里 `system:user:list/add/edit/delete`、`system:role:list`、`system:menu:list`。

**下发链路**：登录后前端调 `GET /auth/me`（`AuthController.me`），返回：

- 用户基本信息；
- `roles`：角色编码列表（`SysRoleRepository.findRoleCodesByUserId`）；
- `perms`：权限点列表（`SysMenuRepository.findPermsByUserId`——`sys_menu ⨝ sys_role_menu ⨝ sys_user_role` 三表关联取 DISTINCT perm，menu 与 button 类型的 perm 都算在内）。

前端据此过滤菜单可见性与路由兜底（详见 `docs/02-frontend.md` 与 `docs/05-rbac-datascope.md`）。注意：**后端 API 层当前没有按权限点做强制校验**（全库无 `@PreAuthorize`），只校验登录态，权限点目前约束的是前端可见性，这是已知缺口，`ErrorCode.PERMISSION_DENIED(10004)` 已预留给后续接入。

管理接口：`UserController`（`/users`，CRUD + `POST /users/{id}/roles` 分配角色）、`RoleController`（`/roles`，CRUD + `POST /roles/{id}/menus` 分配菜单/权限点，均全量覆盖语义）、`MenuController`（`/menus`）。写操作都带 `@AuditLog` 审计。

---

## 5. 审计

组成：`@AuditLog` 注解（`framework-common/.../annotation/AuditLog.java`，标在 Controller 方法上，`module` + `action` 两参数）+ `AuditLogAspect`（`framework-system/.../aspect/AuditLogAspect.java`）+ `AuditLogService`（`.../service/AuditLogService.java`）。

切面 `@Around` 环绕拦截，记录内容：

- 操作人：从 `SecurityContext` 取 `LoginUser`（userId + username），无登录态记 `anonymous`；
- `bizId`：第一个 `Long` 型参数（一般是路径上的 `{id}`）；
- 参数摘要：过滤掉 `HttpServletRequest`/`MultipartFile`，`String::valueOf` 拼接，超过 1000 字符截断；
- `detail`（jsonb）：手工拼装的 JSON `{args, success, error?, method}`，方法抛异常也会记录（success=false + 异常类名和 message）后原样 rethrow；
- `traceId`：`TraceIdHolder.get()`（与网关头串联，可按 traceId 把网关日志和审计记录对上）；
- `ip`：`X-Forwarded-For` 第一跳。

落库走 `AuditLogService.record`，`@Async` 异步写 `sys_audit_log`，落库失败只打 warn，**审计故障不影响主流程**。注释里写明了演进方向：后续改投 RabbitMQ（audit.exchange，按 module 路由）削峰解耦。

登录日志独立一张 `sys_login_log`（`LoginLogService`，同样 `@Async`），成功/失败都记，与操作审计分开。

schema.sql 头部注释已提示：两张日志表增长快，后期建议按月 `PARTITION BY RANGE (created_at)` 声明式分区并定期归档，本期单表实现。已有索引：`created_at`、`trace_id`。

---

## 6. 审批引擎

自研轻量状态机（不引 Flowable），全部逻辑在 `framework-system/.../service/ApprovalEngineService.java`（约 960 行，类注释即设计文档）。配套表：`form_definition`（动态表单，Formily JSON Schema）、`flow_definition`（流程定义）、`approval_template`（模板 = 表单 + 流程，业务方按 `code` 发起）、`approval_instance`（实例）、`approval_task`（任务）。

### 6.1 流程 JSON 模型（flow_definition.flow_json）

树形结构，顶层 `{nodes:[...]}`，三种节点：

- `approver`：`{type, name, approverType, approvers[], signMode, allowAddSign?}`
  - `approverType=member`：approvers 直接是审批人姓名（realName 口径）；
  - `approverType=role`：approvers 是角色编码，解析时按 `SysUserRepository.findRealNamesByRoleCode` 全库查在职用户；
  - `approverType=deptLeader`：approvers 是部门 ID；**注意 sys_dept 暂无 leader 字段，本期实现取该部门全部在职人员**（代码注释已标注待组织架构完善后改为 leader）；
  - `signMode=or` 或签 / `all` 会签，缺省 `or`；
  - `allowAddSign === false` 时该节点禁止加签，缺省允许。
- `cc`：`{type, name, ccUsers[]}`，只生成抄送记录，不阻塞流程。
- `condition`：`{type, name, branches:[{name, isDefault, conditions:[{field, op, value}], children:[...]}]}`，分支 children 是递归的子节点数组。

引擎推进前先把树形**按实例的 form_data 展开为扁平执行序列**（`expandNodes`），`nodeId` 用索引路径编码（如 `1/0/0`：第 1 个节点 → condition 的第 0 个分支 → 分支内第 0 个节点）。condition 节点选第一个命中的非默认分支（多条件「且」），都不命中走 `isDefault` 分支，分支 children 递归插入序列。form_data 创建后不变（resubmit 可覆盖但重新展开），所以每次推进重算展开结果即可，无需存执行计划。

### 6.2 状态机

**实例状态**（`approval_instance.status`）：`PENDING`（在途）→ `APPROVED`（全部节点走完）/ `REJECTED`（任一驳回 targetType=end）/ `RETURNED`（退回发起人，等 resubmit）。CANCELED 只是任务态，实例不会处于 CANCELED。

**任务状态**（`approval_task.status`）：`PENDING`（待办）、`WAITING`（被前加签挂起）、`APPROVED`、`REJECTED`、`CC`（抄送记录）、`CANCELED`（被回退作废的终态，**不进任何列表、不参与进度**）。任务另有 `origin`（NORMAL/ADD_BEFORE/ADD_AFTER）、`parent_task_id`（加签链）、`sort`（实例内递增，决定进度顺序）。

推进规则：

- approver 节点按解析出的审批人生成 PENDING 任务并暂停；cc 节点逐人生成 CC 记录 + 发抄送通知后继续推进。
- 或签：任一人通过即过，通过后删除同节点其余 PENDING 任务（`deletePendingSiblings`）；会签：无任何 PENDING/WAITING 任务才算集齐。
- **节点完成判定把加签链算在内**（`nodePassed`）：存在 WAITING 或未完成的加签任务（PENDING 且 origin≠NORMAL）时节点不完成——即或签下加了签，也必须等加签链走完，由加签任务的通过触发完成判定。
- 审批人解析为空视为配置错误，直接抛异常（`IllegalStateException`），不静默跳过节点。
- 全部节点走完 → 实例 APPROVED、`finished_at` 落时间，发 MQ 事件。

**加签**（`addSign`，处理人本人在自己的 PENDING 任务上操作，v1 限制同一任务最多加签一次、不能对自己加签）：

- 前加签（before）：原任务挂起为 WAITING，新建 origin=ADD_BEFORE 任务给指定人；加签人通过后 `restoreParentTask` 把原任务 WAITING→PENDING 并重新通知原审批人，**节点不推进**；
- 后加签（after）：原任务记 comment 置 APPROVED，新建 origin=ADD_AFTER 任务占住本节点，指定人通过后才做节点完成判定；
- 加签任务被驳回与普通驳回一致 → 实例 REJECTED。

**驳回四去向**（`reject`，`targetType`，驳回意见必填）：

| targetType | 语义 |
| --- | --- |
| `end`（缺省） | 驳回人任务记 REJECTED 留痕，删除全部 PENDING/WAITING 任务，实例 REJECTED，发 approval.finished |
| `prev` | 回退到展开序列中当前节点之前最近的 approver 节点 |
| `node` | 回退到 `targetNodeId` 指定的前置 approver 节点（不在当前节点之前则 400） |
| `initiator` | 退回发起人：实例置 RETURNED，未处理任务 CANCELED，通知发起人，**不发 approval.finished**（业务单保持「待审批」） |

`prev`/`node` 的清理规则（`rejectBack`）：驳回人任务 REJECTED 留痕；其余未处理任务（PENDING/WAITING）置 CANCELED；被回退区间 (target, current] 内已产生的 APPROVED/CC 任务也置 CANCELED（重跑时按节点配置重新生成）；REJECTED 历史留痕不动。目标节点重新生成 PENDING 任务并通知「驳回后重新审批」，实例保持 PENDING。当前节点不在流程定义中（快照路径失配）直接报错，不容错为整体驳回。

**重新提交**（`resubmit`）：仅 RETURNED 实例、仅发起人本人（控制器校验 JWT realName 与 initiatorName 一致）；formData 非空则覆盖（条件分支重新求值），实例回 PENDING，从起点重新展开。**沿用创建时的快照**，实例始终按发起时的流程版本走。

**CANCELED / RETURNED 语义小结**：CANCELED 是任务的作废终态（回退产生，用户不可见）；RETURNED 是实例的「终态前人工干预态」，只有发起人能通过 resubmit 把它拉回 PENDING，且不发结束事件，业务方业务单在此期间保持待审批。

### 6.3 progress 构建

`buildProgress` 给审批中心详情页用，复用 `expandNodes`（与推进同一套代码，condition 按 form_data 求值并带 `branchName`），**输出按执行顺序的全量序列，动作不折叠**：

- approver 节点内按任务 id（发生顺序）展开：每条已动作任务（APPROVED→DONE、REJECTED→REJECTED，含加签，加签条目名为「前加签-XX」/「后加签-XX」）各出一个条目（带 comment/actedAt）；处理中的加签任务一条 CURRENT；普通 PENDING/WAITING 汇总为一条 CURRENT（assignees=待处理人）。多轮动作（同意→驳回→回退重审→再加签）全部按序留痕；
- 节点完全无任务：当前点之前兜底 DONE、之后 PENDING（按配置解析审批人）；
- CANCELED 任务不进进度；实例整体 REJECTED 时当前点锚定到最新 REJECTED 任务所在节点，其后节点 PENDING（后端给全量，前端负责截断展示）；
- 流程不可用（无快照且模板/流程定义被删）时返回 null 容错。

### 6.4 approval.finished MQ 事件

实例 APPROVED / REJECTED（仅 targetType=end）时由 `ApprovalEventPublisher` 发到 topic exchange `framework.events`，routing key `approval.finished`，载荷 `{templateCode, businessKey, status}`（`framework-system/.../mq/ApprovalFinishedEvent.java`，字段契约保持稳定）。消费队列由业务服务自行声明绑定。发布失败只打 warn 不影响主流程（业务方状态由对账/重推兜底）。RETURNED 不发事件。

### 6.5 流程版本快照（flow_snapshot）

`approval_instance.flow_snapshot` 在创建实例时冻结为当时的 `flow_definition.flow_json`。之后引擎**所有**展开——推进、进度、驳回回退、resubmit——一律按快照求值（`loadInstanceFlow`），设计器后续修改流程定义不影响在途实例；resubmit 也不更新快照。仅历史实例（快照为空）回退读模板当前流程定义并打 warn。这是"在途实例行为确定"的核心保证，改流程定义前不用考虑迁移在途实例。

### 6.6 条件数值比较规则

`compare`（包级私有 static，有单测 `framework-system/src/test/java/com/framework/system/service/ApprovalEngineConditionCompareTest.java`）：

- 两个操作数都能解析为数值（`BigDecimal`；JSON 数字节点或数字字符串 `"5"`/`5`/`"5.5"` 都算）→ 数值比较，支持 `< <= > >= = !=` 全部六种（所以 `"9" < "10"` 为 true）；
- 否则只有 `=` / `!=` 按字符串精确比较；`< <= > >=` 对非数值操作数判**不命中**并打 warn——不做字符串大小比较，避免 `"abc" < "10"` 这类配置错误静默产出错误结果；
- 操作符归一化：`<`/`lt`、`<=`/`≤`/`lte`、`>`/`gt`、`>=`/`≥`/`gte`、`!=`/`≠`/`ne`，其余按 `=`；
- 任一侧为 null 直接不命中。

### 6.7 发起入口

- 前端页面：`POST /approval/instances`（`ApprovalInstanceController`，带登录态）；
- 业务服务内调：`POST /internal/approval/instances`（`InternalApprovalController`，免 JWT，`SecurityConfig` 放行 `/internal/**`，发起人由调用方传入 `initiatorName`）。

---

## 7. 通知中心

表 `notification`：`user_name`（接收人，**realName 口径**）、`type`（APPROVAL/CC/SYSTEM，业务方可扩展）、`title`、`content`、`biz_key`（业务定位键，如 `approval:7`，CC 通知用业务单号）、`is_read`、`created_at`。索引 `(user_name, is_read)`、`created_at`。

创建收口在一个方法：`NotificationService.create`（`framework-system/.../service/NotificationService.java`），三路触发共用：

1. **审批引擎**（`ApprovalEngineService`）：新审批任务（advanceFrom，type=APPROVAL）、抄送（type=CC）、驳回后重新审批、退回发起人、加签任务通知、前加签完成后恢复原任务的通知；
2. **内调接口** `POST /internal/notifications`（`InternalNotificationController`）：其他服务直连建通知，userName/title 必填，type 缺省 SYSTEM；
3. **MQ 通道** `notification.send`：业务服务发事件到 `framework.events`（routing key `notification.send`），`NotificationSendListener` 消费队列 `framework.system.notification.send`（system 侧声明绑定，见 `config/RabbitConfig.java`）落表；生产端类名通过 `idClassMapping` 映射到消费侧 DTO，userName 为空丢弃并 warn。与内调接口并行，是不走 REST 的通道。

用户侧接口（`NotificationController`，`/notifications`）：分页查询（按 userName，可过滤未读/类型）、`/unread-count`、`POST /{id}/read`、`POST /read-all`。

---

## 8. 中间件与部署

### 8.1 中间件复用（deploy/docker-compose.yml 注释即约定）

本框架不新增中间件，全部复用 mcn-platform 已在运行的容器：

| 中间件 | 容器 | 端口 | 本框架用法 |
| --- | --- | --- | --- |
| PostgreSQL 16 | mcn-postgres | 5432 | 独立库 `ef`（`CREATE DATABASE ef;`） |
| Redis 7 | mcn-redis | 6379 | 同实例（密码 `mcn_redis_123`），按需分 db |
| RabbitMQ | mcn-rabbitmq | 5672 | 同 vhost，exchange/queue 均为 `framework.*` 前缀 |
| Nacos 3.x | mcn-nacos-verify | 18848 | 同实例，dataId 为 `framework-*.yaml` |

连接参数全部在 Nacos 配置（`deploy/nacos/framework-system.yaml`），可用环境变量覆盖：`POSTGRES_*`、`REDIS_*`、`RABBITMQ_*`、`NACOS_ADDR`、`JWT_SECRET` 等。

### 8.2 schema.sql 幂等机制

`framework-system/src/main/resources/schema.sql` 随服务启动执行（`spring.sql.init.mode=always`，`jpa.hibernate.ddl-auto=none`——**表结构以 schema.sql 为准，JPA 不建表**）。全部语句幂等，可反复执行：

- 建表/建索引：`CREATE TABLE/INDEX IF NOT EXISTS`；
- 存量库补列：`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（如 `sys_user.password`、`sys_role.dept_ids`、`approval_instance.flow_snapshot`、`approval_task.origin/parent_task_id`）；
- 种子数据：`INSERT ... SELECT ... WHERE NOT EXISTS`（按 username / role code / 菜单 title+type / perm 判重）；
- 数据修补：`UPDATE ... WHERE ... IS NULL`（如补空密码、回填 form_definition.code、绑流程 form_id）。

新增表/种子时沿用这套写法，不要写非幂等语句。

种子数据一览：部门（总经理办公室/研发部/市场部）；角色 ADMIN(ALL)/DEPT_LEADER(DEPT)/EMPLOYEE(SELF)；用户 admin/zhangsan/lisi（初始密码均 `123456`）；系统管理菜单树（3 个 dir + 6 个 menu + 用户管理下 3 个 button 权限点）；ADMIN 角色授予全部菜单；审批演示（表单 LEAVE_APPLY + 流程「请假审批流程」+ 模板 LEAVE：部门负责人审批(role) → 条件分支[days>3 → 总经理审批] → 抄送李四）。

### 8.3 启动命令（详见根 README「快速开始」）

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

# 3. 构建并启动后端（JDK 21）
cd backend && mvn -DskipTests clean package
NACOS_ADDR=localhost:18848 REDIS_PASSWORD=mcn_redis_123 RABBITMQ_USER=mcn RABBITMQ_PASS=mcn123456 \
  java -jar framework-gateway/target/framework-gateway-1.0.0.jar &
NACOS_ADDR=localhost:18848 REDIS_PASSWORD=mcn_redis_123 RABBITMQ_USER=mcn RABBITMQ_PASS=mcn123456 \
  java -jar framework-system/target/framework-system-1.0.0.jar &
```

无 Nacos 时也能起：配置导入是 `optional:` 前缀，按默认值启动（连接 localhost 默认端口）。

### 8.4 排错入口

- 服务日志：`backend/logs/framework-gateway.log`、`backend/logs/framework-system.log`。网关每个请求一条 `方法 路径 -> 状态码 (耗时) traceId=...`；拿着 traceId 去 system 日志和 `sys_audit_log.trace_id` 串全链路。
- 健康检查：网关 `/actuator/health|info|gateway`（查路由生效），system `/actuator/health|info`（经网关分别走 `/actuator/**`、`/api/system/actuator/**`——后者在 SecurityConfig 里只放行了 `/actuator/health`）。
- 登录问题：先查 `sys_login_log` 的 success/message；401 一律表现为「未认证或认证已过期」或「用户名或密码错误」，具体原因在日志表和服务日志里。
- 审批问题：实例当前节点看 `approval_instance.current_node_path`；任务流转按 `approval_task.sort` 排；流程版本问题先确认 `flow_snapshot` 是否为空（为空会打「实例无流程快照」warn）；条件分支不命中查服务日志里「非数值操作数」warn。
