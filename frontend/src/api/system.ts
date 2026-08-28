import { mockResolve } from '@/mocks/helper'
import {
  mockAuditLogs,
  mockDepartments,
  mockMenus,
  mockPermissionTree,
  mockRolePermissions,
  mockRoles,
  mockUsers,
  type AuditLogItem,
  type MenuItem,
  type PermissionNode,
  type RoleItem,
  type UserItem,
} from '@/mocks/system'

export interface PageResult<T> {
  data: T[]
  total: number
  success: boolean
}

function paginate<T>(list: T[], current = 1, pageSize = 10): PageResult<T> {
  const start = (current - 1) * pageSize
  return {
    data: list.slice(start, start + pageSize),
    total: list.length,
    success: true,
  }
}

/**
 * DataTable 列头筛选的 mock 降级处理：select 筛选精确匹配，text 筛选包含匹配。
 * 真实接口由后端实现，这里仅保证 mock 链路行为一致。
 */
export function applyColumnFilters<T>(list: T[], filters?: Record<string, any[]>): T[] {
  if (!filters) return list
  let out = list
  Object.entries(filters).forEach(([key, values]) => {
    if (!values || values.length === 0) return
    out = out.filter((row) => {
      const cell = String((row as Record<string, unknown>)[key] ?? '')
      return values.some((v) => cell === String(v) || cell.includes(String(v)))
    })
  })
  return out
}

// ---------------- 用户管理 ----------------

export function fetchUsers(params: {
  current?: number
  pageSize?: number
  name?: string
  username?: string
  filters?: Record<string, any[]>
}): Promise<PageResult<UserItem>> {
  // 真实接口：return request.get('/system/users', { params })
  let list = mockUsers
  if (params.name) list = list.filter((u) => u.name.includes(params.name!))
  if (params.username) list = list.filter((u) => u.username.includes(params.username!))
  list = applyColumnFilters(list, params.filters)
  return mockResolve(paginate(list, params.current, params.pageSize))
}

export function createUser(payload: Partial<UserItem>) {
  // 真实接口：return request.post('/system/users', payload)
  return mockResolve({ success: true, payload })
}

export function updateUser(id: number, payload: Partial<UserItem>) {
  // 真实接口：return request.put(`/system/users/${id}`, payload)
  return mockResolve({ success: true, id, payload })
}

export function deleteUser(id: number) {
  // 真实接口：return request.delete(`/system/users/${id}`)
  return mockResolve({ success: true, id })
}

// ---------------- 角色权限 ----------------
// 后端契约：GET /system/roles?pageNum&pageSize → { list: [{id, code, name, dataScope, deptIds, createdAt}], total }；
// POST/PUT/DELETE /system/roles(/id)；权限分配 POST /system/roles/{id}/menus（全量覆盖，body 为 menuId 数组）。
// 与审批模块同款策略：先走真实接口，请求失败（后端未启动等）降级到本地 mock。

/** 归一化真实角色：dataScope 兜底 SELF；description/userCount 后端暂无，留空由页面兜底展示 */
function normalizeRole(raw: any): RoleItem {
  return {
    id: raw?.id ?? 0,
    name: raw?.name ?? '',
    code: raw?.code ?? '',
    dataScope: (raw?.dataScope as RoleItem['dataScope']) ?? 'SELF',
    deptIds: Array.isArray(raw?.deptIds) ? raw.deptIds : null,
    description: raw?.description ?? undefined,
    userCount: typeof raw?.userCount === 'number' ? raw.userCount : undefined,
    status: raw?.status ?? 1,
  }
}

export async function fetchRoles(params: {
  current?: number
  pageSize?: number
  name?: string
  filters?: Record<string, any[]>
}): Promise<PageResult<RoleItem>> {
  try {
    await ensureSystemToken()
    const res = await request.get('/system/roles', {
      params: { pageNum: params.current, pageSize: params.pageSize },
    })
    const data = unwrap<{ list: any[]; total: number }>(
      res as Result<{ list: any[]; total: number }>,
    )
    return { data: (data.list ?? []).map(normalizeRole), total: data.total ?? 0, success: true }
  } catch {
    let list = mockRoles
    if (params.name) list = list.filter((r) => r.name.includes(params.name!))
    list = applyColumnFilters(list, params.filters)
    return notifyFallback('GET /system/roles', paginate(list, params.current, params.pageSize))
  }
}

export async function createRole(payload: Partial<RoleItem>) {
  try {
    await ensureSystemToken()
    return await request.post('/system/roles', payload)
  } catch {
    const item: RoleItem = {
      id: Math.max(0, ...mockRoles.map((r) => r.id)) + 1,
      name: payload.name ?? '',
      code: payload.code ?? '',
      dataScope: payload.dataScope ?? 'SELF',
      deptIds: payload.deptIds ?? null,
      description: payload.description,
      userCount: 0,
      status: 1,
    }
    mockRoles.push(item)
    return notifyFallback('POST /system/roles', { success: true, id: item.id })
  }
}

export async function updateRole(id: number, payload: Partial<RoleItem>) {
  try {
    await ensureSystemToken()
    return await request.put(`/system/roles/${id}`, payload)
  } catch {
    const target = mockRoles.find((r) => r.id === id)
    if (target) Object.assign(target, payload)
    return notifyFallback(`PUT /system/roles/${id}`, { success: true, id })
  }
}

export async function deleteRole(id: number) {
  try {
    await ensureSystemToken()
    return await request.delete(`/system/roles/${id}`)
  } catch {
    const idx = mockRoles.findIndex((r) => r.id === id)
    if (idx >= 0) mockRoles.splice(idx, 1)
    return notifyFallback(`DELETE /system/roles/${id}`, { success: true, id })
  }
}

/**
 * 角色已分配权限点查询。后端仅有分配接口（POST /system/roles/{id}/menus），
 * 查询接口 GET /system/roles/{id}/menus 待后端补，当前固定走本地 mock。
 */
export function fetchRolePermissions(id: number): Promise<number[]> {
  // 真实接口（待后端补）：return request.get(`/system/roles/${id}/menus`)
  return mockResolve([...(mockRolePermissions[id] ?? [])])
}

/**
 * 保存角色权限（全量覆盖）。后端为 POST /system/roles/{id}/menus（body: menuId 数组）；
 * 后端不可达时降级写入本地 mock，刷新页面后失效。
 */
export async function saveRolePermissions(id: number, menuIds: number[]) {
  try {
    await ensureSystemToken()
    return await request.post(`/system/roles/${id}/menus`, menuIds)
  } catch {
    mockRolePermissions[id] = [...menuIds]
    return notifyFallback(`POST /system/roles/${id}/menus`, { success: true, id, menuIds })
  }
}

/**
 * 权限配置树（目录/菜单/按钮三级）。真实接口 GET /system/menus 为平铺
 * {id, parentId, title, type}，这里按 parentId 组装成树；失败降级 mock 树。
 */
export async function fetchPermissionTree(): Promise<PermissionNode[]> {
  try {
    await ensureSystemToken()
    const res = await request.get('/system/menus')
    const data = unwrap<any[] | { list: any[] }>(res as Result<any[] | { list: any[] }>)
    const list: any[] = Array.isArray(data) ? data : (data.list ?? [])
    if (!list.length) throw new Error('empty menu list')
    const nodes = new Map<number, PermissionNode>()
    list.forEach((m) => nodes.set(m.id, { title: m.title ?? m.name ?? `#${m.id}`, key: m.id }))
    const roots: PermissionNode[] = []
    list.forEach((m) => {
      const node = nodes.get(m.id)!
      const parent = m.parentId ? nodes.get(m.parentId) : undefined
      if (parent) {
        parent.children = parent.children ?? []
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    })
    return roots
  } catch {
    return notifyFallback('GET /system/menus', mockPermissionTree)
  }
}

/**
 * 部门选项（CUSTOM 数据范围的部门多选）。后端尚无部门管理接口
 * （GET /system/depts 待后端补），当前固定走本地 mock。
 */
export function fetchDeptOptions(): Promise<{ label: string; value: number }[]> {
  // 真实接口（待后端补）：return request.get('/system/depts')
  return mockResolve(mockDepartments.map((d) => ({ label: d.name, value: d.id })))
}

// ---------------- 菜单管理 ----------------
// 后端契约：GET /system/menus → 平铺 [{id, parentId, title, type(dir/menu/button), path, icon, perm, sort}]；
// POST/PUT/DELETE /system/menus(/id)。与角色同款策略：先走真实接口，失败降级本地 mock。

/** 归一化真实菜单：字段兜底，保证前端组树/路由装配不炸 */
function normalizeMenu(raw: any): MenuItem {
  return {
    id: raw?.id ?? 0,
    parentId: raw?.parentId ?? 0,
    title: raw?.title ?? '',
    type: (raw?.type as MenuItem['type']) ?? 'menu',
    path: raw?.path ?? null,
    icon: raw?.icon ?? null,
    perm: raw?.perm ?? null,
    sort: raw?.sort ?? 0,
  }
}

/** 全量菜单（平铺）。动态路由、侧边栏、菜单管理页共用这一份数据。 */
export async function fetchMenus(): Promise<MenuItem[]> {
  try {
    await ensureSystemToken()
    const res = await request.get('/system/menus')
    const data = unwrap<any[] | { list: any[] }>(res as Result<any[] | { list: any[] }>)
    const list: any[] = Array.isArray(data) ? data : (data.list ?? [])
    if (!list.length) throw new Error('empty menu list')
    return list.map(normalizeMenu)
  } catch {
    return notifyFallback('GET /system/menus', mockMenus.map((m) => ({ ...m })))
  }
}

export interface MenuPayload {
  parentId: number
  title: string
  type: MenuItem['type']
  path?: string | null
  icon?: string | null
  perm?: string | null
  sort?: number
}

export async function createMenu(payload: MenuPayload) {
  try {
    await ensureSystemToken()
    return await request.post('/system/menus', payload)
  } catch {
    const item: MenuItem = {
      id: Math.max(0, ...mockMenus.map((m) => m.id)) + 1,
      parentId: payload.parentId,
      title: payload.title,
      type: payload.type,
      path: payload.path ?? null,
      icon: payload.icon ?? null,
      perm: payload.perm ?? null,
      sort: payload.sort ?? 0,
    }
    mockMenus.push(item)
    return notifyFallback('POST /system/menus', { success: true, id: item.id })
  }
}

export async function updateMenu(id: number, payload: MenuPayload) {
  try {
    await ensureSystemToken()
    return await request.put(`/system/menus/${id}`, payload)
  } catch {
    const target = mockMenus.find((m) => m.id === id)
    if (target) Object.assign(target, payload)
    return notifyFallback(`PUT /system/menus/${id}`, { success: true, id })
  }
}

export async function deleteMenu(id: number) {
  try {
    await ensureSystemToken()
    return await request.delete(`/system/menus/${id}`)
  } catch {
    const idx = mockMenus.findIndex((m) => m.id === id)
    if (idx >= 0) mockMenus.splice(idx, 1)
    return notifyFallback(`DELETE /system/menus/${id}`, { success: true, id })
  }
}

/**
 * 级联删除：后端 DELETE /system/menus/{id} 是单条 deleteById，不级联
 * （直接删目录会把子项孤儿化），因此在 api 层先递归删子项再删自身。
 */
export async function deleteMenuCascade(id: number): Promise<void> {
  const all = await fetchMenus()
  const childrenOf = (pid: number) => all.filter((m) => m.parentId === pid)
  const collect = (mid: number): number[] => [
    ...childrenOf(mid).flatMap((c) => collect(c.id)),
    mid,
  ]
  // collect 返回顺序即「子 → 父」，逐条删除即可
  for (const mid of collect(id)) {
    await deleteMenu(mid)
  }
}

// ---------------- 审计日志 ----------------

export function fetchAuditLogs(params: {
  current?: number
  pageSize?: number
  operator?: string
  module?: string
  filters?: Record<string, any[]>
}): Promise<PageResult<AuditLogItem>> {
  // 真实接口：return request.get('/system/audit-logs', { params })
  let list = mockAuditLogs
  if (params.operator) list = list.filter((l) => l.operator.includes(params.operator!))
  if (params.module) list = list.filter((l) => l.module.includes(params.module!))
  list = applyColumnFilters(list, params.filters)
  return mockResolve(paginate(list, params.current, params.pageSize))
}

// ---------------- 通知中心（第四期，try 真实接口 / catch 降级 mock） ----------------

import request from './request'
import { ensureSystemToken } from './approval'
import { mockNotifications, type NotificationItem } from '@/mocks/system'

interface Result<T> {
  code?: number
  message?: string
  data: T
}

function unwrap<T>(res: Result<T> | T): T {
  if (res && typeof res === 'object' && 'data' in res) {
    return (res as Result<T>).data
  }
  return res as T
}

function notifyFallback<T>(api: string, data: T): Promise<T> {
  console.warn(`[api/system] ${api} 请求失败，已降级到本地 mock 数据`)
  return mockResolve(data)
}

export interface NotificationQuery {
  userName: string
  unreadOnly?: boolean
  page?: number
  size?: number
}

function filterNotifications(q: NotificationQuery): NotificationItem[] {
  let list = mockNotifications.filter((n) => n.userName === q.userName)
  if (q.unreadOnly) list = list.filter((n) => !n.read)
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function fetchNotifications(q: NotificationQuery): Promise<PageResult<NotificationItem>> {
  try {
    await ensureSystemToken()
    const res = await request.get('/system/notifications', {
      params: {
        userName: q.userName,
        unreadOnly: q.unreadOnly || undefined,
        page: q.page,
        size: q.size,
      },
    })
    const data = unwrap<{ list: NotificationItem[]; total: number }>(
      res as Result<{ list: NotificationItem[]; total: number }>,
    )
    return { data: data.list, total: data.total, success: true }
  } catch {
    return notifyFallback('GET /system/notifications', paginate(filterNotifications(q), q.page, q.size))
  }
}

export async function fetchUnreadCount(userName: string): Promise<number> {
  try {
    await ensureSystemToken()
    const res = await request.get('/system/notifications/unread-count', { params: { userName } })
    const data = unwrap<number | { count: number }>(res as Result<number | { count: number }>)
    return typeof data === 'number' ? data : (data?.count ?? 0)
  } catch {
    return notifyFallback(
      'GET /system/notifications/unread-count',
      filterNotifications({ userName, unreadOnly: true }).length,
    )
  }
}

export async function markNotificationRead(id: number) {
  try {
    await ensureSystemToken()
    return await request.post(`/system/notifications/${id}/read`)
  } catch {
    const target = mockNotifications.find((n) => n.id === id)
    if (target) target.read = true
    return notifyFallback(`POST /system/notifications/${id}/read`, { success: true })
  }
}

export async function markAllNotificationsRead(userName: string) {
  try {
    await ensureSystemToken()
    return await request.post('/system/notifications/read-all', null, { params: { userName } })
  } catch {
    mockNotifications.forEach((n) => {
      if (n.userName === userName) n.read = true
    })
    return notifyFallback('POST /system/notifications/read-all', { success: true })
  }
}

