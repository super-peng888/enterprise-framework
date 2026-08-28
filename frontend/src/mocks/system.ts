export interface UserItem {
  id: number
  username: string
  name: string
  phone: string
  role: string
  status: 0 | 1
  createdAt: string
}

/** 数据范围五档（与后端 sys_role.data_scope 一致） */
export type DataScope = 'ALL' | 'DEPT_AND_CHILD' | 'DEPT' | 'SELF' | 'CUSTOM'

export interface RoleItem {
  id: number
  name: string
  code: string
  dataScope: DataScope
  /** CUSTOM 档自定义部门 ID 集合 */
  deptIds?: number[] | null
  /** 真实接口暂无该字段，展示时兜底 */
  description?: string
  /** 真实接口暂无该字段，展示时兜底 */
  userCount?: number
  status: 0 | 1
}

/** 数据范围展示元数据：标签 + 说明 + 卡片 Tag 色系（对应 roles.css 的 scope-{tone}） */
export const DATA_SCOPE_META: Record<
  DataScope,
  { label: string; desc: string; tone: 'green' | 'blue' | 'cyan' | 'orange' | 'violet' }
> = {
  ALL: { label: '全部数据', desc: '可查看全部部门数据', tone: 'green' },
  DEPT_AND_CHILD: { label: '本部门及以下', desc: '可查看本部门及下级部门数据', tone: 'blue' },
  DEPT: { label: '本部门', desc: '仅可查看本部门数据', tone: 'cyan' },
  SELF: { label: '仅本人', desc: '仅可查看本人数据', tone: 'orange' },
  CUSTOM: { label: '自定义', desc: '仅可查看所选部门数据', tone: 'violet' },
}

export interface DeptItem {
  id: number
  name: string
}

/**
 * 菜单/权限点（与后端 sys_menu 平铺结构一致）。
 * path 约定：组件地址（相对 src/pages，如 system/users/Users.tsx），
 * 前端动态路由取其所在目录作为路由路径（system/users/Users.tsx → /system/users）。
 */
export interface MenuItem {
  id: number
  /** 父级 id，顶级为 0 */
  parentId: number
  title: string
  type: 'dir' | 'menu' | 'button'
  /** 组件地址（type=menu 时有值），dir/button 为 null */
  path: string | null
  /** lucide 图标名，缺省前端用 File 兜底 */
  icon: string | null
  /** 权限码（如 system:user:list），为空表示登录即可见 */
  perm: string | null
  sort: number
  /** 前端按 parentId 组树后挂载 */
  children?: MenuItem[]
}

export interface AuditLogItem {
  id: number
  operator: string
  module: string
  action: string
  summary: string
  ip: string
  createdAt: string
}

export const mockUsers: UserItem[] = [
  { id: 1, username: 'admin', name: '系统管理员', phone: '138****0001', role: '平台超管', status: 1, createdAt: '2025-01-12 09:30:00' },
  { id: 2, username: 'zhangsan', name: '张三', phone: '139****0002', role: '部门负责人', status: 1, createdAt: '2025-02-03 14:12:00' },
  { id: 3, username: 'lisi', name: '李四', phone: '137****0003', role: '普通员工', status: 1, createdAt: '2025-02-20 10:05:00' },
  { id: 4, username: 'wangwu', name: '王五', phone: '136****0004', role: '普通员工', status: 1, createdAt: '2025-03-08 16:40:00' },
  { id: 5, username: 'zhaoliu', name: '赵六', phone: '135****0005', role: '普通员工', status: 0, createdAt: '2025-03-15 11:22:00' },
  { id: 6, username: 'sunqi', name: '孙七', phone: '134****0006', role: '部门负责人', status: 1, createdAt: '2025-04-02 09:18:00' },
]

export const mockRoles: RoleItem[] = [
  { id: 1, name: '平台超管', code: 'ADMIN', dataScope: 'ALL', deptIds: null, description: '拥有全部权限，可查看全部部门数据', userCount: 1, status: 1 },
  { id: 2, name: '部门负责人', code: 'DEPT_LEADER', dataScope: 'DEPT_AND_CHILD', deptIds: null, description: '本部门及以下审批与管理，可查看下级部门数据', userCount: 2, status: 1 },
  { id: 3, name: '普通员工', code: 'EMPLOYEE', dataScope: 'SELF', deptIds: null, description: '发起审批与个人信息查看', userCount: 3, status: 1 },
  { id: 4, name: '财务专员', code: 'FINANCE', dataScope: 'CUSTOM', deptIds: [4], description: '仅可查看财务部及相关数据', userCount: 1, status: 1 },
  { id: 5, name: '访客', code: 'GUEST', dataScope: 'DEPT', deptIds: null, description: '只读访问', userCount: 0, status: 0 },
]

/** 部门列表（CUSTOM 数据范围的部门多选；真实接口 /system/depts 待后端补） */
export const mockDepartments: DeptItem[] = [
  { id: 1, name: '总经理办公室' },
  { id: 2, name: '研发部' },
  { id: 3, name: '市场部' },
  { id: 4, name: '财务部' },
  { id: 5, name: '人力资源部' },
]

/** 与后端种子菜单（schema.sql）一致的平铺列表，作为接口降级数据 */
export const mockMenus: MenuItem[] = [
  { id: 6, parentId: 0, title: '工作台', type: 'dir', path: null, icon: 'LayoutDashboard', perm: null, sort: 1 },
  { id: 7, parentId: 6, title: '仪表盘', type: 'menu', path: 'dashboard/Dashboard.tsx', icon: 'LayoutDashboard', perm: null, sort: 1 },
  { id: 8, parentId: 6, title: '发起审批', type: 'menu', path: 'approval/launch/Launch.tsx', icon: 'Send', perm: null, sort: 2 },
  { id: 9, parentId: 6, title: '审批中心', type: 'menu', path: 'approval/center/ApprovalCenter.tsx', icon: 'ListChecks', perm: null, sort: 3 },
  { id: 10, parentId: 0, title: '审批管理', type: 'dir', path: null, icon: 'Workflow', perm: null, sort: 2 },
  { id: 11, parentId: 10, title: '流程设计', type: 'menu', path: 'approval/designer/FlowDesigner.tsx', icon: 'Workflow', perm: null, sort: 1 },
  { id: 12, parentId: 10, title: '表单中心', type: 'menu', path: 'approval/forms/FormCenter.tsx', icon: 'ClipboardList', perm: null, sort: 2 },
  { id: 1, parentId: 0, title: '系统管理', type: 'dir', path: null, icon: 'Settings', perm: null, sort: 3 },
  { id: 2, parentId: 1, title: '用户管理', type: 'menu', path: 'system/users/Users.tsx', icon: 'UserCog', perm: 'system:user:list', sort: 1 },
  { id: 3, parentId: 1, title: '角色权限', type: 'menu', path: 'system/roles/Roles.tsx', icon: 'ShieldCheck', perm: 'system:role:list', sort: 2 },
  { id: 4, parentId: 1, title: '菜单管理', type: 'menu', path: 'system/menus/Menus.tsx', icon: 'ListTree', perm: 'system:menu:list', sort: 3 },
  { id: 13, parentId: 1, title: '审计日志', type: 'menu', path: 'system/audit-logs/AuditLogs.tsx', icon: 'History', perm: null, sort: 4 },
  { id: 14, parentId: 2, title: '新增用户', type: 'button', path: null, icon: null, perm: 'system:user:add', sort: 1 },
  { id: 15, parentId: 2, title: '编辑用户', type: 'button', path: null, icon: null, perm: 'system:user:edit', sort: 2 },
  { id: 16, parentId: 2, title: '删除用户', type: 'button', path: null, icon: null, perm: 'system:user:delete', sort: 3 },
]

export const mockAuditLogs: AuditLogItem[] = [
  { id: 1, operator: '系统管理员', module: '用户管理', action: '新增用户', summary: '新增用户「孙七」，角色：部门负责人', ip: '10.12.8.21', createdAt: '2026-08-14 18:02:11' },
  { id: 2, operator: '张三', module: '审批中心', action: '审批通过', summary: '请假申请「李四-事假 2 天」审批通过', ip: '10.12.8.33', createdAt: '2026-08-14 16:45:03' },
  { id: 3, operator: '李四', module: '审批中心', action: '提交审批', summary: '提交请假申请「年假 5 天」，等待部门负责人审批', ip: '10.12.9.10', createdAt: '2026-08-14 15:20:47' },
  { id: 4, operator: '系统管理员', module: '系统管理', action: '修改角色', summary: '角色「部门负责人」新增权限点 approval:flow:edit', ip: '10.12.8.21', createdAt: '2026-08-14 11:37:55' },
  { id: 5, operator: '系统管理员', module: '审批管理', action: '发布表单', summary: '发布表单「请假申请」（LEAVE_APPLY）v2 画布版本', ip: '10.12.8.52', createdAt: '2026-08-14 10:05:18' },
  { id: 6, operator: '张三', module: '审批中心', action: '审批驳回', summary: '请假申请「李四-调休 1 天」被驳回：调休额度不足', ip: '10.12.8.33', createdAt: '2026-08-13 17:52:40' },
  { id: 7, operator: '系统管理员', module: '用户管理', action: '禁用用户', summary: '禁用用户「赵六」（离职流程中）', ip: '10.12.8.21', createdAt: '2026-08-13 14:08:36' },
  { id: 8, operator: '系统管理员', module: '系统管理', action: '更新菜单', summary: '菜单「审批中心」排序 3 → 2', ip: '10.12.8.21', createdAt: '2026-08-13 11:24:19' },
  { id: 9, operator: '系统管理员', module: '系统管理', action: '导出日志', summary: '导出 7 月审计日志（CSV）', ip: '10.12.8.52', createdAt: '2026-08-13 09:47:51' },
  { id: 10, operator: '系统管理员', module: '系统管理', action: '新增角色', summary: '新增角色「访客」（只读访问）', ip: '10.12.8.21', createdAt: '2026-08-12 18:15:07' },
]

/**
 * 角色权限点勾选树（目录/菜单/按钮三级）。key 为菜单 id（与后端 sys_menu 对齐，
 * 保存时直接作为 menuIds 提交 POST /system/roles/{id}/menus）。
 */
export interface PermissionNode {
  title: string
  key: number
  children?: PermissionNode[]
}

export const mockPermissionTree: PermissionNode[] = [
  {
    title: '工作台',
    key: 101,
    children: [
      { title: '仪表盘', key: 111, children: [{ title: '查看', key: 1111 }] },
      {
        title: '发起审批',
        key: 112,
        children: [
          { title: '提交', key: 1121 },
          { title: '草稿箱', key: 1122 },
        ],
      },
      {
        title: '审批中心',
        key: 113,
        children: [
          { title: '同意', key: 1131 },
          { title: '驳回', key: 1132 },
          { title: '加签', key: 1133 },
        ],
      },
    ],
  },
  {
    title: '审批管理',
    key: 102,
    children: [
      {
        title: '流程设计',
        key: 121,
        children: [
          { title: '新建流程', key: 1211 },
          { title: '发布流程', key: 1212 },
        ],
      },
      {
        title: '表单中心',
        key: 122,
        children: [
          { title: '新建表单', key: 1221 },
          { title: '发布表单', key: 1222 },
        ],
      },
    ],
  },
  {
    title: '系统管理',
    key: 103,
    children: [
      {
        title: '用户管理',
        key: 131,
        children: [
          { title: '新建用户', key: 1311 },
          { title: '禁用用户', key: 1312 },
        ],
      },
      {
        title: '角色权限',
        key: 132,
        children: [
          { title: '新建角色', key: 1321 },
          { title: '分配权限', key: 1322 },
        ],
      },
      {
        title: '菜单管理',
        key: 133,
        children: [{ title: '维护菜单', key: 1331 }],
      },
      {
        title: '审计日志',
        key: 134,
        children: [
          { title: '查看日志', key: 1341 },
          { title: '导出日志', key: 1342 },
        ],
      },
    ],
  },
]

/** 角色已分配权限点的 mock（GET /system/roles/{id}/menus 待后端补） */
export const mockRolePermissions: Record<number, number[]> = {
  1: [1111, 1121, 1122, 1131, 1132, 1133, 1211, 1212, 1221, 1222, 1311, 1312, 1321, 1322, 1331, 1341, 1342],
  2: [1111, 1121, 1122, 1131, 1132, 1133, 1211, 1221],
  3: [1111, 1121, 1122],
  4: [1111, 1131, 1341],
  5: [1111],
}

// ---------------- 通知中心 ----------------

export type NotificationType = '审批' | '逾期' | '系统' | 'CC'

export interface NotificationItem {
  id: number
  type: NotificationType
  title: string
  content: string
  read: boolean
  userName: string
  createdAt: string
}

const notifyTime = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60000).toLocaleString('zh-CN', { hour12: false })

export const mockNotifications: NotificationItem[] = [
  {
    id: 1,
    type: '审批',
    title: '请假审批待处理',
    content: '请假申请-李四-年假 5 天 已提交，等待总经理审批。',
    read: false,
    userName: '张三',
    createdAt: notifyTime(25),
  },
  {
    id: 2,
    type: 'CC',
    title: '请假审批抄送',
    content: '请假申请-李四-事假 2 天 已通过审批，结果抄送给你。',
    read: false,
    userName: '李四',
    createdAt: notifyTime(60 * 30),
  },
  {
    id: 3,
    type: '审批',
    title: '审批结果通知',
    content: '你提交的请假申请「调休 1 天」被驳回：调休额度不足，请核实后重新申请。',
    read: false,
    userName: '李四',
    createdAt: notifyTime(60 * 9),
  },
  {
    id: 4,
    type: '系统',
    title: '账号权限变更',
    content: '你的角色已由 普通员工 调整为 部门负责人，权限即时生效。',
    read: true,
    userName: '张三',
    createdAt: notifyTime(60 * 26),
  },
  {
    id: 5,
    type: '系统',
    title: '系统版本更新',
    content: 'EF Admin 企业级管理框架已升级，新增表单设计器与流程设计器。',
    read: true,
    userName: '系统管理员',
    createdAt: notifyTime(60 * 50),
  },
]
