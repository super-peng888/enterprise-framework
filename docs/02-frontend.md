# 前端架构

> 面向接手者的前端总览。所有结论均以 `frontend/` 当前代码为准，文件路径均给出，改动前先读原文。

代码根目录：`frontend/`（包名 `ef-admin`），Vite 开发端口 `5175`，`/api` 代理到后端网关 `http://localhost:8090`（`frontend/vite.config.ts`）。

## 1. 技术栈与工程约定

| 项 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | React 18 + TypeScript | `react ^18.3.1`，函数组件 + Hooks |
| 构建 | Vite 7 | `@` 别名指向 `src`（`vite.config.ts`） |
| UI | antd 6.6.0 | 主题经 `ConfigProvider` token 配置，见第 2 节 |
| 路由 | react-router-dom 6 | 动态路由，见第 3 节 |
| 状态 | zustand 5（+ persist） | 三个 store，见第 4 节 |
| 请求 | axios | 统一实例 `src/api/request.ts`，见第 5 节 |
| 图标 | lucide-react | 菜单图标走后端字符串映射（`src/utils/menuIcons.tsx`） |
| 其他 | @xyflow/react（流程设计器）、echarts + echarts-for-react（图表）、dayjs | 见 `package.json` |

**刻意不用 `@ant-design/pro-components`**：布局（侧边栏/顶栏/面包屑）、表格搜索区等都是手写组件（`src/layouts/MainLayout.tsx`、`src/components/DataTable`、`src/components/FormModal` 等），为的是完全掌控主题变量与视觉细节（灰底白卡、Logo 胶囊、菜单选中态等）。新增页面沿用这套手写件，不要引 pro-components。

其他约定：

- 样式为手写 CSS（无 Tailwind），每页/每布局一个同名 `.css`，主题相关的颜色**一律用 CSS 变量**，不要写死色值。
- mock 数据集中在 `src/mocks/`（`system.ts`、`approval.ts`、`helper.ts`），页面组件不直接 import mock，一律经 `src/api/*` 访问。
- 脚本：`pnpm dev` / `pnpm build`（`tsc -b && vite build`）/ `pnpm preview`。

## 2. 主题系统

### 2.1 双主题双轨机制

两套主题：浅色 `cool`（默认）/ 深色 `dark`，类型 `ThemeKey` 定义在 `src/stores/theme.ts`。

主题同时走两条轨道，切主题时两边必须一致：

1. **CSS 变量轨**：`App.tsx` 的 `useEffect` 把 `themeKey` 写到 `<html data-theme="...">`，`src/styles/themes.css` 用 `[data-theme='cool']` / `[data-theme='dark']` 两个属性选择器给出全套变量。`src/styles/global.css` 的 `:root` 里还有一份兜底默认值（等于 cool），是 JS 挂载前的防闪烁；**新增主题变量时 global.css 与 themes.css 两处要同步**。
2. **antd token 轨**：`App.tsx` 顶部的 `ANTD_THEMES: Record<ThemeKey, ThemeConfig>`，cool 用 `defaultAlgorithm`、dark 用 `darkAlgorithm`，两套 token（主色、文字、背景、边框、圆角、Table 组件级覆盖）与 themes.css 的变量一一对应。两边均开了 `cssVar: {}`。

持久化在 theme store（localStorage key `ef-theme`），并带 v0→v1 迁移：历史版本有暖色 `warm` 主题，残留值一律回落 `cool`（`src/stores/theme.ts`）。

### 2.2 布局结构（灰底白卡）

2026-08 布局重构后的结构（`src/layouts/MainLayout.tsx` + `MainLayout.css`）：

- **应用底**：平色灰，cool `--bg-page: #f7f7f7`（dark `#14161a`），body 直接铺底。
- **侧边栏透明**：`.sidebar` `background: transparent`，透出应用底灰；宽 210px（折叠 72px），`position: sticky` 撑满 100vh。
- **body 圆角大卡**：右侧 `.main-body` 是一张浮起的白色圆角大卡（`--body-radius: 18px`，`--layout-gap: 8px` 与视口的间距），dark 下为深色磨砂浮板（`rgba(255,255,255,0.05)` + `blur(24px)`）。
- **分割线左右对齐（硬性约束）**：`.sidebar-logo` 高度 = `--header-height: 60px` = `.header` 高度，且 sidebar 顶部 padding 与 body 卡 margin 同为 `--layout-gap`，因此 `.sidebar-divider` 与 `.header` 的 `border-bottom` 在同一 y 坐标。改动 logo 区/顶栏高度时两条线都要顾。

关键视觉变量（定义在 themes.css / global.css）：

- **Logo 胶囊** `.logo-pill`：`--surface` 白底 + `--border-strong` 发丝边 + `--card-shadow`，内嵌蓝色图标块（`#2563eb` 固定色）与标题「EF Admin」。
- **菜单搜索框** `.sidebar-search`：同胶囊材质，输入即按页面名过滤菜单（保留有命中项的分组）。
- **菜单选中态**：`--menu-selected-bg` 灰色圆角底（cool `#ececee` / dark `rgba(255,255,255,0.1)`）+ `--menu-selected-color` 近黑（dark 纯白）文字加粗；hover 为 `--menu-hover-bg`。**无紫无渐变**，这是设计红线。
- **深色主按钮**：`--color-primary` cool 为近黑 `#1f2124`（白字），dark 反转为浅底 `#eceef2`（深字，`--color-primary-contrast`）；质感来自 `--btn-primary-shadow`（顶部微高光 + 细腻投影），`global.css` 里用 `!important` 压过 antd cssinjs 默认阴影。
- **环境光晕** `.ambient-glows`：5 团固定定位径向渐变，仅 dark 渲染（cool 下 `display: none`），给深色磨砂一点可模糊的背景色。

### 2.3 筑梦黑字体

`src/styles/fonts.css` 注册 Dream Han Sans CN（筑梦黑），文件在 `src/assets/fonts/`：

- `DreamHanSansCN-W7.otf` → `font-weight: 400 500`（正文）
- `DreamHanSansCN-W14.otf` → `font-weight: 600 700 800 900`（标题粗体）
- CJK 全字库单个约 34MB，`font-display: swap` 不阻塞渲染。

**antd 必须用 token 覆盖字体**：antd 6 默认字体栈含 Noto Sans SC，会压过 body 的 font-family，因此 `ANTD_THEMES` 两套 token 里都显式设了 `fontFamily: "'Dream Han Sans CN', ..."`（见 `App.tsx` 注释）。新加 antd 主题配置时不要漏掉这一项。

## 3. 动态路由（菜单驱动装配）

路由的单一数据源是**后端菜单**，前端几乎不写静态路由。装配链路：

1. **登录**（`src/pages/login/Login.tsx`）：`POST /system/auth/login` 换 token → `GET /system/auth/me` 取 `username` / `realName` / `perms` → 写入 auth store → 跳 `/dashboard`。后端不可达时有「离线演示模式」入口，写入 `mock-token-<时间戳>`。
2. **守卫**（`src/router/RequireAuth.tsx`）：无 token → 跳 `/login`（带 `from`）；有 token → 触发 menu store `load()` 拉 `GET /system/menus`，并按需 `syncPerms()`；菜单与权限点未就绪时全屏 Spin。
3. **注册表**（`src/router/registry.ts`）：`import.meta.glob('../pages/**/*.tsx')` 扫描全部页面组件，生成「组件地址 → `React.lazy`」映射。
4. **装配**（`App.tsx` 的 `dynamicRoutes`）：菜单中 `type === 'menu'` 且有 `path` 且 `menuVisible(m, perms)` 通过的项，`resolvePageComponent(path)` 懒加载挂到 `MainLayout` 的 children 下；未命中注册表只 `console.warn` 不炸。
5. **兜底**：`MainLayout` 下 `path="*"` → `src/router/RouteFallback.tsx`：路径命中菜单但无权限 → 403；其余 → 404。静态路由只剩 `/login` 和 index 重定向到 `/dashboard`。

**组件地址约定**：菜单的 `path` 字段存相对 `src/pages` 的组件文件路径（带 `.tsx`，不带 `pages/` 前缀），如 `system/users/Users.tsx`；路由路径取其**所在目录**，即 `/system/users`（`routePathOf()`）。`normalizeComponentPath()` 容忍前导 `/` 和误带的 `pages/` 前缀。`pageComponentPaths` 是菜单管理页「组件地址」下拉的数据源（`src/pages/system/menus/Menus.tsx`）。

**侧边栏与面包屑同源**（`MainLayout.tsx`）：两者都从同一份 menus 展开——侧边栏把 `type=dir` 渲染为 antd Menu group、`type=menu` 为项（`type=button` 不进侧边栏，未挂目录的顶级菜单归入「其他」组）；面包屑按 `location.pathname` 前缀匹配菜单取「目录名 / 菜单名」。菜单图标名（lucide 字符串）经 `src/utils/menuIcons.tsx` 的 `MENU_ICON_MAP` 映射，未命中一律 `File` 兜底。

## 4. 状态管理（zustand）

### 4.1 auth store — `src/stores/auth.ts`

persist 到 localStorage（key `ef-auth`）。字段：

- `token` / `userName`（登录账号，如 admin）/ `realName`（真实姓名，如 张三——网关注入下游的 `X-User-Name` 与审批/通知「按人」过滤的口径）
- `perms: string[]`：权限点（如 `system:user:manage`），菜单按它显隐
- `permsLoaded: boolean`：perms 是否已从 `/auth/me` 同步过

方法：`login(token, userName, realName?)`、`syncMe({ perms })`、`syncPerms()`（动态 import request 拉 `/system/auth/me`，失败不覆盖旧 perms 但置 `permsLoaded`，防无限阻塞）、`logout()`（清空全部）。

**为什么 token 变化要强制 `syncPerms`**（`RequireAuth.tsx`）：persist 恢复的 perms 可能过期（角色被调整过、或 token 是外部注入的），重新登录/切号时旧账号的权限点不能残留，所以 `prevToken !== token` 时强制重拉菜单（`load(force)`）并重同步 perms；登出时 `reset()` 清菜单缓存。

### 4.2 menu store — `src/stores/menu.ts`

不 persist。`menus` 为全量平铺菜单（含 dir/button，未按权限过滤），`load(force?)` 有 `loading`/`loaded` 守卫防止重复拉取；`force` 用于菜单管理页增删改后即时刷新和 token 变化时强制重载。配套纯函数：

- `buildMenuTree(flat)`：按 `parentId` 组树，`sort` 升序，父级缺失的孤儿提升为顶级。
- `menuVisible(menu, perms)`：`perm` 为空即登录可见，否则要求用户 perms 命中——侧边栏、动态路由、403 判定三处共用。

接口失败时 `fetchMenus` 内部已降级 mock 菜单（见第 5 节），store 拿到的永远是可用列表。

### 4.3 theme store — `src/stores/theme.ts`

`themeKey: 'cool' | 'dark'` + `setTheme`，persist（key `ef-theme`），带 warm 残留迁移（见 2.1）。顶栏单按钮在两套主题间切换。

## 5. 请求层与 mock 降级

### 5.1 axios 封装 — `src/api/request.ts`

- `baseURL: '/api'`（dev 下代理到网关 8090），timeout 15s。
- 请求拦截：从 auth store 取 token 塞 `Authorization: Bearer`。
- 响应拦截：成功直接返回 `response.data`；**401 一律 `logout()` 并跳 `/login`**。

后端统一返回 `Result<T>` 包装（`{ code, message/msg, data }`），各 api 文件里有本地 `unwrap()` 兼容裸数据；错误文案兼容 `msg`/`message`（见 `Login.tsx` 的 `resultMsg`）。

### 5.2 try 真实接口 / catch 降级 mock

`src/api/approval.ts`、`src/api/system.ts`（角色/菜单/通知部分）的每个导出函数都是同一模式：

```ts
export async function fetchFlows(): Promise<FlowDef[]> {
  try {
    const res = await request.get('/system/flows')
    // unwrap + 字段归一化（JSON 字符串解析、缺省兜底），保证页面拿到的形状稳定
    return ...
  } catch {
    return fallback('GET /system/flows', [...mockFlows])  // console.warn + mockResolve 本地数据
  }
}
```

要点：

- **try 里做归一化**：真实接口的 schema/flowJson 是 JSON 字符串（`parseJson` 容错解析）、角色缺 `dataScope` 兜底 `SELF`、菜单空列表视为失败（`throw new Error('empty menu list')`）以触发降级。
- **catch 里维持写操作假象**：增删改失败时直接改 `src/mocks` 里的数组（push/splice/Object.assign），返回成功——页面交互完整可演示，刷新后失效。
- **降级可见**：`fallback`/`notifyFallback` 会 `console.warn('[api/xxx] GET /xxx 请求失败，已降级到本地 mock 数据')`，联调时看控制台就知道哪些接口还没通。
- **`ensureSystemToken()`**（`api/approval.ts`）：system 服务需登录态。mock-token 且后端可达时用 `{ code: 'mock' }` 换真 token；已有真 token 也调一次 `/auth/me` 对齐身份（同步 realName/perms，修正历史会话）。只尝试一次（`loginTried` 守卫）。
- 少数接口后端尚未提供（角色权限查询 `GET /system/roles/{id}/menus`、部门 `GET /system/depts`、审计日志），代码里以「真实接口（待后端补）」注释标记，当前固定走 mock。

**好处**：前端不依赖后端进度——后端没起，登录页走「离线演示模式」，全站用 mock 数据照常开发、截图、演示；后端接口陆续就绪后无需改前端代码，try 分支自然生效。前后端可完全独立开发。

## 6. 页面地图（`src/pages/`）

| 路由 | 组件 | 职责 |
| --- | --- | --- |
| `/login` | `login/Login.tsx` | 扫码占位 + 账号密码登录 + 离线演示入口 |
| `/dashboard` | `dashboard/Dashboard.tsx` | 工作台：统计卡（pastel chip）+ 图表 + 待办概览 |
| `/system/users` | `system/users/Users.tsx` | 用户管理：分页搜索表格 + 增删改（当前走 mock） |
| `/system/roles` | `system/roles/Roles.tsx` | 角色权限：角色 CRUD + 数据范围 + 权限树分配 |
| `/system/menus` | `system/menus/Menus.tsx` | 菜单管理：目录/菜单/按钮三级 CRUD，配组件地址、图标、权限码（级联删除在 api 层处理） |
| `/system/audit-logs` | `system/audit-logs/AuditLogs.tsx` | 审计日志：操作记录查询（当前走 mock） |
| `/approval/center` | `approval/center/ApprovalCenter.tsx` | 审批中心：我的待办/已办/我发起的，按 realName 过滤 |
| `/approval/designer` | `approval/designer/FlowDesigner.tsx` | 流程设计器：@xyflow/react 画布编排审批节点/条件分支 |
| `/approval/forms` | `approval/forms/FormCenter.tsx` + `FormDesigner.tsx` | 表单中心与表单设计器：schema 驱动的表单定义 |
| `/approval/launch` | `approval/launch/Launch.tsx` | 发起审批：选表单/流程提交实例 |

通用组件在 `src/components/`：`DataTable`（搜索区悬浮条 + 列头筛选 + 自动撑高）、`FormModal`、`SchemaForm`（按 schema 渲染表单，含 group/block 分区，样式类在 global.css）、`NotificationBell`（通知铃铛）、`Building.tsx`（占位页）。

## 7. 扩展指南

### 7.1 新增页面（标准三步）

1. **放组件**：在 `src/pages/` 下按「目录/页面目录/Component.tsx」建文件，如 `report/sales/Sales.tsx`（目录名即路由段）。`import.meta.glob` 自动收录，无需注册。
2. **配菜单**：进「系统管理 → 菜单管理」，新建 `type=menu`，「组件地址」下拉选 `report/sales/Sales.tsx`（自动带出路由 `/report/sales`），填图标（lucide 名，可参照 `ICON_SUGGESTIONS`）、权限码（留空 = 登录可见）、排序；需要分组就先建/选一个 `type=dir`。
3. **完成**：菜单保存后 `load(force)` 即时刷新，动态路由、侧边栏、面包屑、权限过滤全部自动生效。前端零改动。

### 7.2 新增 api 函数（标准写法）

```ts
// src/api/xxx.ts
export async function fetchThings(params: {...}): Promise<PageResult<Thing>> {
  // 顶部注释写清后端契约：方法/路径/出入参形状
  try {
    await ensureSystemToken()                 // system 服务需要登录态
    const res = await request.get('/system/things', { params })
    const data = unwrap<...>(res as Result<...>)
    return ...                                 // 归一化成页面要的稳定形状
  } catch {
    return notifyFallback('GET /system/things', mockThings)  // 降级本地 mock + console.warn
  }
}
```

规则：mock 数据进 `src/mocks/`；页面不感知真假接口；后端没就绪的接口先写「真实接口（待后端补）」注释、固定走 mock。

## 8. CDP 截图调试工具（`frontend/scripts/`）

一组零依赖（Node ≥ 22）的 CDP（Chrome DevTools Protocol）脚本，用于无头浏览器截图与交互复现，是核对 UI 效果的主要手段。

**前置**：启动带调试端口的 Edge headless 实例（脚本只注释了前置条件、不含启动命令）。历史上用的独立 profile 目录还在 `scripts/out/.edge-profile`，启动命令形如：

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless --remote-debugging-port=9222 \
  --user-data-dir=scripts/out/.edge-profile about:blank
```

**三个截图脚本**：

- `node scripts/shot3-real.mjs <path> <out.png> [waitMs] [width] [height] [theme] [username]` —— **首选**。调真实后端登录拿 token，经 `Page.addScriptToEvaluateOnNewDocument` 预注入 localStorage（`ef-auth`，可选 `ef-theme`），单次导航截图。需 dev server 5175 + 后端 8090。
- `node scripts/shot3-mock.mjs <path> <out.png> ...` —— 不依赖后端，预注入 mock 登录态，api 层自然降级 mock 数据。只需 dev server。
- `node scripts/shot3.mjs` —— 早期版本（端口写死 9222，无环境变量），功能同 real 版。real/mock 版支持 `CDP_PORT` / `BASE_URL` / `API_URL` 环境变量覆盖。

示例（Git Bash）：

```bash
node scripts/shot3-real.mjs /dashboard /tmp/dash.png 7000 1680 1400 dark admin
```

其余脚本：`verify-*.mjs`（断言式交互验证）、`drag-test.mjs` / `repro-insert.mjs`（流程设计器交互复现）、`check-font.mjs` / `check-cursor.mjs` / `inspect-edges.mjs` / `debug-auth.mjs`（专项排查），套路相同：`/json/list` 找 page target → WebSocket 发 CDP 指令。

**注意事项**：

- **Git Bash 下带 `/` 开头的参数会被 MSYS2 路径转换吃掉**（如 `/json/new?about:blank`、页面路径），报错前先加 `MSYS2_ARG_CONV_EXCL="*"`：`MSYS2_ARG_CONV_EXCL="*" node scripts/repro-insert.mjs`。
- **无头实例偶发「冻结」**：同一个 headless 实例跑久了，CDP 事件（导航完成、截图返回）偶发不回调，脚本卡在等待上。不要死等重试——kill 掉重新起一个 headless 实例（或换端口 + `CDP_PORT`）再跑。shot3 系列每次运行都会 `PUT /json/new?about:blank` 新建干净 target，能缓解但不能根治。
- 截图后务必看一眼图再下结论；`waitMs`（默认 7000）对图表/设计器页可能需要调大。
