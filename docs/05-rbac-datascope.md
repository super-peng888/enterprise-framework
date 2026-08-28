# 05 · RBAC 与数据权限

RBAC 管"能不能看/能不能点"，`@DataScope` 管"能看哪些行"。两者都挂在角色上：菜单/权限点通过 `sys_role_menu` 授权，数据范围通过 `sys_role.data_scope` 五档控制。本文给出表结构、权限点约定、数据权限机制和业务方接入步骤。代码引用路径相对 `backend/`。

---

## 1. RBAC 模型与表结构

模型是经典的 用户 → 角色 → 菜单/权限点 三级，外加部门表支撑数据权限（`framework-system/src/main/resources/schema.sql`）：

```
sys_user ──< sys_user_role >── sys_role ──< sys_role_menu >── sys_menu
   │                                                             
sys_dept（部门树，parent_id 自关联）                             
```

### 1.1 表字段说明

**sys_user（用户）**

| 字段 | 说明 |
| --- | --- |
| `id` | BIGSERIAL 主键 |
| `username` | 登录名，全局唯一 |
| `real_name` | 真实姓名。系统内「人」的统一口径：审批任务、通知、网关头全部按 realName |
| `password` | BCrypt 哈希（存量库 `ADD COLUMN IF NOT EXISTS` 补列） |
| `feishu_union_id` / `feishu_open_id` | 飞书账号绑定（union_id 唯一），扫码登录预留 |
| `dept_id` | 所属部门，数据权限 DEPT 系档位以此为准 |
| `status` | 1 在职/启用，0 离职/禁用；登录与审批人解析都过滤 status=1 |

**sys_role（角色）**

| 字段 | 说明 |
| --- | --- |
| `code` | 角色编码，唯一（如 ADMIN） |
| `name` | 角色名 |
| `data_scope` | 数据范围五档：ALL / DEPT_AND_CHILD / DEPT / SELF / CUSTOM，默认 SELF（详见第 4 节） |
| `dept_ids` | jsonb，CUSTOM 档的自定义部门 ID 集合（JSON 数组） |

**sys_user_role / sys_role_menu**：纯关联表，复合主键，无外键约束，删除用户/角色时由代码清理（见 `UserController.delete`、`RoleController.delete`）。

**sys_menu（菜单/权限点，一表三用）**

| 字段 | 说明 |
| --- | --- |
| `parent_id` | 父菜单，0 为根 |
| `title` | 显示名 |
| `type` | `dir` 目录 / `menu` 菜单 / `button` 按钮（权限点），默认 menu |
| `path` | 前端组件地址（相对 `frontend/src/pages`，如 `system/users/Users.tsx`），dir/button 为 NULL |
| `icon` | lucide 图标名 |
| `perm` | 权限点串（如 `system:user:list`），详见第 2 节 |
| `sort` | 同级排序 |

**sys_dept（部门）**：`parent_id`（0 为根）、`name`、`feishu_dept_id`。当前无负责人字段（审批引擎 deptLeader 类型因此取全部门在职人员，见 01 册 6.1）。

### 1.2 平台角色种子

schema.sql 启动时幂等插入（不存在才插）：

| 角色 code | 名称 | data_scope | 绑定用户 |
| --- | --- | --- | --- |
| `ADMIN` | 平台超管 | ALL | admin（系统管理员，总经理办公室） |
| `DEPT_LEADER` | 部门负责人 | DEPT | zhangsan（张三，研发部） |
| `EMPLOYEE` | 普通员工 | SELF | lisi（李四，市场部） |

三个用户初始密码均为 `123456`（BCrypt，只补空密码）。菜单种子含 3 个目录（工作台/审批管理/系统管理）、6 个菜单页（仪表盘、发起审批、审批中心、流程设计、表单中心 + 系统管理下 4 页）、用户管理下 3 个按钮权限点（`system:user:add/edit/delete`）；ADMIN 角色授予全部菜单。

---

## 2. 权限点约定

### 2.1 权限点串

格式 `module:resource:action`，全部小写冒号分隔：

- `module`：模块名，平台为 `system`，业务模块用自己的名（如 `biz`）；
- `resource`：资源名，如 `user`、`role`、`menu`；
- `action`：动作，惯用 `list`/`add`/`edit`/`delete`，可按需扩展（`export`、`approve` 等）。

种子里已有的：`system:user:list`、`system:user:add`、`system:user:edit`、`system:user:delete`、`system:role:list`、`system:menu:list`。

### 2.2 菜单三类各自的作用

| type | 作用 |
| --- | --- |
| `dir` | 侧边栏分组，无 path 无 perm，只做层级 |
| `menu` | 页面菜单：path 指向前端组件，参与动态路由；perm 非空时要求用户 perms 命中才可见，**perm 为空表示登录即可见** |
| `button` | 纯权限点：不进侧边栏、无 path，唯一作用是把 perm 通过角色授权汇入用户的 perms 列表，供按钮级控制使用 |

### 2.3 按钮权限的前后端联动（现状如实说明）

**已落地的链路**：

1. 后端 `GET /auth/me`（`framework-system/.../controller/AuthController.java`）返回 `perms`——`SysMenuRepository.findPermsByUserId` 三表关联（`sys_menu ⨝ sys_role_menu ⨝ sys_user_role`）取 DISTINCT perm，**menu 和 button 类型的 perm 都会下发**；
2. 前端 `useAuthStore`（`frontend/src/stores/auth.ts`）持久化 `perms`，`RequireAuth` 在 token 变化时强制重新同步 `/auth/me`（防 persist 的旧 perms 过期）；
3. 菜单可见性：`menuVisible`（`frontend/src/stores/menu.ts`）= `!menu.perm || perms.includes(menu.perm)`，`MainLayout` 用它过滤侧边栏（button 类型不进侧栏），`RouteFallback` 用它做路由兜底（无权限命中 → forbidden 页）。

**尚未落地、如实说明的两点**：

- **前端按钮级显隐**：按钮型权限点已在种子和菜单管理页（`Menus.tsx` 可加 button 型）里就绪，perms 也已下发到前端，但当前页面代码里还没有按 perms 控制按钮显隐的统一封装（页面未引用 `system:user:add` 等权限点做判断）。接入方式是在页面里读 `useAuthStore().perms` 判断渲染，或封一个 `<PermGuard perm="...">` 组件。
- **后端 API 层校验**：当前后端只校验登录态（SecurityConfig `anyRequest().authenticated()`），**全库无 `@PreAuthorize`、未开启 `@EnableMethodSecurity`，权限点在 API 层未强制**。这意味着拿到 token 后可以直接调任意接口，权限点目前只约束前端可见性。建议接入：SecurityConfig 加 `@EnableMethodSecurity`，在写操作/敏感查询方法上加 `@PreAuthorize("hasAuthority('system:user:add')")`（需要在 `JwtAuthFilter` 建 `Authentication` 时把 perms 装进 authorities，当前是空列表）；`ErrorCode.PERMISSION_DENIED(10004)` 已为此预留。

---

## 3. 菜单可见性与动态路由的关系

menu 型记录的 `path` 是前端组件地址，前端用 `import.meta.glob` 按目录装配动态路由（`system/users/Users.tsx` → `/system/users`），菜单对用户的可见性由 perms 过滤——新增页面 = 放组件 + 菜单管理里配一条 menu 记录。详见 `docs/02-frontend.md`。

---

## 4. @DataScope 数据权限

### 4.1 五档语义

存于 `sys_role.data_scope`，五档语义（`DataScopeInfo.ScopeType`，`framework-common/.../context/DataScopeInfo.java`）：

| 档 | 语义 | 解析结果 |
| --- | --- | --- |
| `ALL` | 全部数据 | 不加任何条件 |
| `DEPT_AND_CHILD` | 本部门及以下（部门树向下递归） | 部门 ID 集合，`deptField IN (集合)` |
| `DEPT` | 本部门 | 仅自己 `dept_id` 一个部门 |
| `SELF` | 仅本人 | `ownerField = 当前用户 ID` |
| `CUSTOM` | 自定义部门集合 | 角色 `dept_ids`（jsonb）指定的部门集合 |

### 4.2 注解与上下文

`@DataScope`（`framework-common/.../annotation/DataScope.java`）标在控制器方法上，两个参数是**实体属性名**口径的约定：

- `ownerField`（默认 `create_by`）：SELF 档按此字段等于当前用户过滤；
- `deptField`（默认 `dept_id`）：DEPT / DEPT_AND_CHILD / CUSTOM 档按此字段 IN 部门集合过滤。

注解本身不改查询——切面解析后写入 `DataScopeContext`（ThreadLocal），**由业务代码自己读上下文拼查询条件**（这是半自动方案：解析自动、叠加手动，换来对任意查询形态的适应性）。

### 4.3 切面解析规则

`DataScopeAspect`（`framework-system/.../aspect/DataScopeAspect.java`）`@Around` 拦截，方法执行前 `DataScopeContext.set(resolve())`，finally 中 `remove()`。`resolve()` 规则：

1. 无登录态（内调等，`Authentication` 里没有 `LoginUser`）→ `ALL` 不限制；
2. 用户没有任何角色 → `SELF` 兜底；
3. 取用户**所有角色中 data_scope 最宽的一档**。档位权重：ALL(1) > DEPT_AND_CHILD(2) > DEPT(3) > SELF(4) > CUSTOM(5)（rank 数字越小越宽，取 min）；未知的 data_scope 值按 SELF 兜底；
4. 各档解析：
   - `DEPT`：用户的 `dept_id` 单元素集合（未分配部门 → 空集合）；
   - `DEPT_AND_CHILD`：以本部门为根，按 `parent_id` 做 BFS 递归收集整棵子树（实现是全量加载 `sys_dept` 构建 childrenMap，部门量大时可改递归 SQL）；
   - `CUSTOM`：**最宽档同为 CUSTOM 的所有角色** `dept_ids` 的并集；
   - `SELF`：当前用户 ID。

注意 CUSTOM 的 rank(5) 比 SELF(4) 小是数值上的特殊处理——语义上「CUSTOM 与 SELF 孰宽」不可比，代码把 CUSTOM 排在最后：只有当用户没有比 SELF 更宽的角色时 CUSTOM 才生效。

### 4.4 SysUser 列表示范

`UserController.page`（`framework-system/.../controller/UserController.java`）是标准用法：

```java
@GetMapping
@DataScope(ownerField = "id", deptField = "deptId")   // sys_user 的归属人即自身 id，归属部门即 deptId
public Result<PageResult<SysUser>> page(...) {
    Page<SysUser> page = userRepository.findAll(dataScopeSpec(), PageRequest.of(...));
    ...
}

private Specification<SysUser> dataScopeSpec() {
    DataScopeInfo scope = DataScopeContext.get();
    if (scope == null || scope.type() == DataScopeInfo.ScopeType.ALL) {
        return null;                                        // 不限制
    }
    return (root, query, cb) -> {
        if (scope.type() == DataScopeInfo.ScopeType.SELF) {
            return cb.equal(root.get("id"), scope.userId()); // 仅本人
        }
        if (scope.deptIds().isEmpty()) {
            return cb.disjunction();                         // 无部门归属 → 永假条件，看不到任何人
        }
        return root.get("deptId").in(scope.deptIds());       // 部门集合
    };
}
```

三个要点：`scope == null`（方法没被切面拦到，例如内部调用）按不限制处理；`ALL` 显式返回 null；`deptIds` 为空要兜底成永假条件（`cb.disjunction()`），不能放行成全表——用户没分配部门时 DEPT 档看到空集而不是全库，这是安全方向上的默认。

---

## 5. 业务方接入指南

### 5.1 业务表加归属字段

业务表加两列（类型与 `sys_user`/`sys_dept` 主键一致）：

```sql
owner_id BIGINT,   -- 数据归属人（sys_user.id），SELF 档用
dept_id  BIGINT    -- 数据归属部门（sys_dept.id），DEPT 系档位用
```

写入时填当前操作人及其部门（从 `UserContext.get()` 取操作人，再查 `sys_user.dept_id`）。实体类对应加 `ownerId`/`deptId` 属性。

### 5.2 查询方法加注解

在控制器查询方法上标 `@DataScope`，并按 4.4 的模式构建 Specification：

```java
@GetMapping
@DataScope(ownerField = "ownerId", deptField = "deptId")
public Result<PageResult<BizOrder>> page(@RequestParam(defaultValue = "1") int pageNum,
                                         @RequestParam(defaultValue = "10") int pageSize) {
    return Result.ok(PageResult.of(
            orderRepository.findAll(dataScopeSpec(), PageRequest.of(...)).getContent(), ...));
}

private Specification<BizOrder> dataScopeSpec() {
    DataScopeInfo scope = DataScopeContext.get();
    if (scope == null || scope.type() == DataScopeInfo.ScopeType.ALL) return null;
    return (root, query, cb) -> {
        if (scope.type() == DataScopeInfo.ScopeType.SELF) {
            return cb.equal(root.get("ownerId"), scope.userId());
        }
        if (scope.deptIds().isEmpty()) return cb.disjunction();
        return root.get("deptId").in(scope.deptIds());
    };
}
```

`DataScopeAspect` 在 framework-system 里；如果业务服务独立部署，需要把该切面（连同 `SysRoleRepository` 等依赖）在业务服务侧复用或复制——当前代码库内业务接口也建在 framework-system 时直接用即可。

### 5.3 新增角色 / 给用户分配角色

- 新增角色：`POST /roles`（`RoleController.create`），body 为 `SysRole` JSON：`{code, name, dataScope, deptIds}`。`dataScope` 填五档之一；`CUSTOM` 档同时填 `deptIds: [1,2,3]`（部门 ID 数组，落 jsonb）。
- 给用户分配角色：`POST /users/{id}/roles`，body 为角色 ID 数组 `[1,2]`，**全量覆盖**语义（先删后插）。用户多角色时数据范围自动取最宽档（见 4.3），不用手工合并。
- 给角色分配菜单/权限点：`POST /roles/{id}/menus`，body 为菜单 ID 数组（含 button 型记录的 id），同样全量覆盖。

以上写操作均带 `@AuditLog` 审计。

### 5.4 新增权限点的标准操作

1. 「菜单管理」页面（或直接插 `sys_menu`）在所属菜单下新增 **type=button** 记录：`title` 填动作名（如「导出用户」），`perm` 填权限点串（如 `system:user:export`），`parent_id` 挂到所属菜单；
2. 「角色权限」页给目标角色勾选该按钮（即 `POST /roles/{id}/menus`）；
3. 前端：用户重新同步 `/auth/me` 后 perms 自动包含新权限点，页面按 `perms.includes('system:user:export')` 控制按钮显隐（封装建议见 2.3）；
4. 后端：按 2.3 的建议用 `@PreAuthorize` 在对应接口上强制校验（当前未强制，依赖前端约束，介意的话这步必做）。
