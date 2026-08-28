import request from './request'
import type { PageResult } from './system'
import { mockResolve } from '@/mocks/helper'
import { useAuthStore } from '@/stores/auth'
import {
  mockAddSign,
  mockFlows,
  mockForms,
  mockInstances,
  mockRejectBack,
  mockResubmit,
  mockTasks,
  mockTemplates,
  nextInstanceId,
  nextTaskId,
  type FlowDef,
  type FormDef,
  type InstanceDetail,
  type InstanceItem,
  type ProgressItem,
  type TaskItem,
  type TemplateDef,
} from '@/mocks/approval'
import { getNodeByPath, MEMBERS, ROLE_DISPLAY } from '@/pages/approval/designer/flow'

/** 当前登录人真实姓名（按人查询的口径；mock 为「张三」） */
export function currentUserName(): string {
  const s = useAuthStore.getState()
  return s.realName || s.userName || '张三'
}

/**
 * 第三期审批引擎接口。网关前缀 /api 之后按 /system/** 路由到 system 服务
 * （StripPrefix=2，需要登录 token）。每个函数先尝试真实接口，请求失败
 * （后端未启动等）时降级到 src/mocks/approval.ts 的本地数据。
 */

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

function fallback<T>(api: string, data: T): Promise<T> {
  console.warn(`[api/approval] ${api} 请求失败，已降级到本地 mock 数据`)
  return mockResolve(data)
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

/** JSON 字符串容错解析：已是对象原样返回，解析失败给默认值 */
function parseJson<T>(raw: unknown, def: T): T {
  if (raw == null) return def
  if (typeof raw !== 'string') return raw as T
  try {
    return JSON.parse(raw) as T
  } catch {
    return def
  }
}

/**
 * system 服务需要登录 token：已有真 token 时调 /auth/me 对齐一次身份（同步 realName）；
 * 模拟登录（mock-token- 前缀）且后端可达时，用 mock 登录码换真 token 后再对齐。
 */
let loginTried = false
export async function ensureSystemToken(): Promise<void> {
  if (loginTried) return
  loginTried = true
  const { token, login, userName } = useAuthStore.getState()
  try {
    // 1) 模拟登录的假 token → 后端可达时用 mock 登录码换真 token（保留降级）
    let realToken = token && !token.startsWith('mock-token-') ? token : null
    if (!realToken) {
      const res = await request.post('/system/auth/login', { code: 'mock' })
      const data = unwrap<{ token?: string }>(res as Result<{ token?: string }>)
      realToken = data?.token ?? null
    }
    if (!realToken) return

    // 2) 身份对齐：真实登录态下必须以后端身份为准。网关注入下游的 X-User-Name 是
    //    realName（真实姓名，如 张三），审批「我发起的/待办/已办」、通知都按它过滤。
    //    即使已有真 token 也要对齐一次（同步 realName，修正历史会话）。
    let meUsername: string | undefined
    let meRealName: string | undefined
    try {
      const me = await request.get('/system/auth/me', {
        headers: { Authorization: `Bearer ${realToken}` },
      })
      const meData = unwrap<{
        user?: { username?: string; realName?: string }
        perms?: string[]
      }>(
        me as Result<{
          user?: { username?: string; realName?: string }
          perms?: string[]
        }>,
      )
      meUsername = meData?.user?.username
      meRealName = meData?.user?.realName
      // 同步权限点（菜单按 perms 显隐）
      useAuthStore.getState().syncMe({ perms: meData?.perms })
    } catch {
      // /auth/me 不可达则保留现有身份
    }
    login(realToken, meUsername ?? userName ?? '张三', meRealName)
  } catch {
    // 后端未启动，保持本地 mock 登录态即可
  }
}

// ---------------- 表单 CRUD ----------------

export async function fetchForms(): Promise<FormDef[]> {
  try {
    const res = await request.get('/system/forms')
    const data = unwrap<FormDef[] | { list: any[] }>(res as Result<FormDef[] | { list: any[] }>)
    const list = Array.isArray(data) ? data : (data.list ?? [])
    // 真实接口 schema 为 JSON 字符串，统一解析为对象（解析失败给空 schema）
    return list.map((f) => ({
      ...f,
      schema: parseJson<FormDef['schema']>(f.schema, { type: 'object', properties: {} }),
    }))
  } catch {
    return fallback('GET /system/forms', [...mockForms])
  }
}

/** 按全局 code 取启用状态的表单（业务页面引用表单的入口） */
export async function fetchFormByCode(code: string): Promise<FormDef | null> {
  try {
    const res = await request.get(`/system/forms/code/${code}`)
    const data = unwrap<any>(res as Result<any>)
    if (!data) return null
    const schema = parseJson<FormDef['schema'] | null>(data.schema, null)
    if (!schema) return null
    return { ...data, schema } as FormDef
  } catch {
    const form = mockForms.find((f) => f.code === code && f.status === 1) ?? null
    return fallback(`GET /system/forms/code/${code}`, form)
  }
}

export async function createForm(payload: Pick<FormDef, 'code' | 'name' | 'schema'>) {
  try {
    return await request.post('/system/forms', { ...payload, status: 1 })
  } catch {
    const item: FormDef = {
      id: Math.max(0, ...mockForms.map((f) => f.id)) + 1,
      code: payload.code,
      name: payload.name,
      schema: payload.schema,
      status: 1,
      updatedAt: now(),
    }
    mockForms.push(item)
    return fallback('POST /system/forms', { success: true, id: item.id })
  }
}

export async function updateForm(id: number, payload: Partial<FormDef>) {
  try {
    return await request.put(`/system/forms/${id}`, payload)
  } catch {
    const target = mockForms.find((f) => f.id === id)
    if (target) Object.assign(target, payload, { updatedAt: now() })
    return fallback(`PUT /system/forms/${id}`, { success: true, id })
  }
}

export async function deleteForm(id: number) {
  try {
    return await request.delete(`/system/forms/${id}`)
  } catch {
    const idx = mockForms.findIndex((f) => f.id === id)
    if (idx >= 0) mockForms.splice(idx, 1)
    return fallback(`DELETE /system/forms/${id}`, { success: true, id })
  }
}

// ---------------- 流程 CRUD ----------------

export async function fetchFlows(): Promise<FlowDef[]> {
  try {
    const res = await request.get('/system/flows')
    const data = unwrap<FlowDef[] | { list: any[] }>(res as Result<FlowDef[] | { list: any[] }>)
    const list = Array.isArray(data) ? data : (data.list ?? [])
    // 真实接口 flowJson 为 JSON 字符串且形如 {"nodes":[...]}，前端为节点数组
    return list.map((f) => {
      const flowJson = parseJson<unknown>(f.flowJson, f.flowJson)
      const nodes = Array.isArray(flowJson)
        ? flowJson
        : ((flowJson as { nodes?: unknown[] })?.nodes ?? [])
      return { ...f, flowJson: nodes } as FlowDef
    })
  } catch {
    return fallback('GET /system/flows', [...mockFlows])
  }
}

export async function createFlow(payload: Pick<FlowDef, 'name' | 'flowJson'> & { formId?: number | null }) {
  try {
    return await request.post('/system/flows', { ...payload, status: 1 })
  } catch {
    const item: FlowDef = {
      id: Math.max(0, ...mockFlows.map((f) => f.id)) + 1,
      name: payload.name,
      flowJson: payload.flowJson,
      formId: payload.formId ?? null,
      status: 1,
    }
    mockFlows.push(item)
    return fallback('POST /system/flows', { success: true, id: item.id })
  }
}

export async function updateFlow(id: number, payload: Partial<FlowDef>) {
  try {
    return await request.put(`/system/flows/${id}`, payload)
  } catch {
    const target = mockFlows.find((f) => f.id === id)
    if (target) Object.assign(target, payload)
    return fallback(`PUT /system/flows/${id}`, { success: true, id })
  }
}

// ---------------- 审批模板 ----------------

export async function fetchTemplates(): Promise<TemplateDef[]> {
  try {
    const res = await request.get('/system/approval/templates')
    const data = unwrap<TemplateDef[] | { list: TemplateDef[] }>(
      res as Result<TemplateDef[] | { list: TemplateDef[] }>,
    )
    return Array.isArray(data) ? data : (data.list ?? [])
  } catch {
    return fallback('GET /system/approval/templates', [...mockTemplates])
  }
}

// 模板 id → 模板缓存（真实实例只有 templateId，templateCode/templateName 由此补齐）
let templateCache: Promise<Map<number, TemplateDef>> | null = null

function loadTemplateMap() {
  if (!templateCache) {
    templateCache = fetchTemplates()
      .then((list) => new Map(list.map((t) => [t.id, t])))
      .catch((e) => {
        templateCache = null
        throw e
      })
  }
  return templateCache
}

// ---------------- 审批实例 ----------------

/** 后端实例状态英文枚举 → 前端中文 */
const INSTANCE_STATUS_IN: Record<string, InstanceItem['status']> = {
  PENDING: '审批中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  CANCELED: '已撤销',
  RETURNED: '已退回',
}

/** 后端任务状态英文枚举 → 前端中文 */
const TASK_STATUS_IN: Record<string, TaskItem['status']> = {
  PENDING: '待处理',
  WAITING: '加签中',
  APPROVED: '已同意',
  REJECTED: '已驳回',
  CC: '已抄送',
  CANCELED: '已作废',
}

/** 归一化真实接口返回的实例：状态中文化、formData 字符串→对象、名称/发起人兜底 */
function normalizeInstance(raw: any, templates: Map<number, TemplateDef> | null): InstanceItem {
  // 任务视图拍平后只有 templateCode 没有 templateId，两种键都要能查到模板名
  const tpl =
    raw?.templateId != null
      ? templates?.get(raw.templateId)
      : raw?.templateCode != null
        ? [...(templates?.values() ?? [])].find((t) => t.code === raw.templateCode)
        : undefined
  const status = INSTANCE_STATUS_IN[raw?.status] ?? raw?.status ?? '审批中'
  return {
    ...raw,
    id: raw?.id ?? 0,
    templateCode: raw?.templateCode ?? tpl?.code ?? '',
    templateName:
      raw?.templateName ?? tpl?.name ?? (raw?.templateId != null ? `#${raw.templateId}` : ''),
    title: raw?.title ?? '',
    businessKey: raw?.businessKey ?? '',
    initiator: raw?.initiator ?? raw?.initiatorName ?? '未知',
    status,
    currentNode:
      raw?.currentNode ?? raw?.currentNodePath ?? (status === '审批中' ? '-' : '流程结束'),
    formData: parseJson<Record<string, unknown>>(raw?.formData, {}),
    createdAt: raw?.createdAt ?? '',
    updatedAt: raw?.updatedAt ?? raw?.finishedAt ?? raw?.createdAt ?? '',
  }
}

/** 归一化真实接口返回的任务：状态中文化、assignee←assigneeName、actedAt 兜底、加签字段透传 */
function normalizeTask(raw: any): TaskItem {
  return {
    ...raw,
    id: raw?.id ?? 0,
    instanceId: raw?.instanceId ?? 0,
    nodeName: raw?.nodeName ?? '',
    nodeType: raw?.nodeType ?? 'approver',
    assignee: raw?.assignee ?? raw?.assigneeName ?? '-',
    status: TASK_STATUS_IN[raw?.status] ?? raw?.status ?? '待处理',
    comment: raw?.comment ?? undefined,
    origin: raw?.origin ?? undefined,
    parentTaskId: raw?.parentTaskId ?? undefined,
    createdAt: raw?.createdAt ?? raw?.actedAt ?? '',
    finishedAt: raw?.finishedAt ?? raw?.actedAt ?? undefined,
  }
}

function filterByAssignee(assignee: string, done: boolean): InstanceItem[] {
  const instanceIds = new Set(
    mockTasks
      .filter((t) => t.assignee === assignee && (done ? t.status !== '待处理' : t.status === '待处理'))
      .map((t) => t.instanceId),
  )
  return mockInstances.filter((i) => instanceIds.has(i.id))
}

/** 抄送我的（mock 降级）：挑 nodeType='cc' 且 assignee=当前用户 的任务，组装对应实例 */
function filterCc(assignee: string): InstanceItem[] {
  const instanceIds = new Set(
    mockTasks
      .filter((t) => t.nodeType === 'cc' && t.assignee === assignee)
      .map((t) => t.instanceId),
  )
  return mockInstances.filter((i) => instanceIds.has(i.id))
}

export type InstanceTab = 'todo' | 'done' | 'mine' | 'cc'

/**
 * 待办/已办/抄送列表的真实返回是任务视图包裹：
 * { task: {id, instanceId, nodeName, status, actedAt, ...},
 *   instanceTitle, instanceStatus, businessKey, initiatorName, templateCode, formData, instanceCreatedAt }
 * 拍平成实例形态供 normalizeInstance 使用（否则 id=0、标题/状态全丢，列表看似空白）。
 */
function unwrapTaskView(raw: any): any {
  if (!raw || typeof raw !== 'object' || !raw.task) return raw
  const t = raw.task
  return {
    id: t.instanceId ?? 0,
    title: raw.instanceTitle ?? '',
    businessKey: raw.businessKey ?? '',
    initiatorName: raw.initiatorName,
    templateCode: raw.templateCode,
    status: raw.instanceStatus,
    formData: raw.formData,
    createdAt: raw.instanceCreatedAt ?? '',
    updatedAt: t.actedAt ?? raw.instanceCreatedAt ?? '',
    currentNode: t.nodeName ?? '',
    // 我的任务信息（列表行快捷操作可用）
    myTaskId: t.id,
    myTaskStatus: t.status,
  }
}

export async function fetchInstances(
  tab: InstanceTab,
  user: string,
): Promise<PageResult<InstanceItem>> {
  const wrap = (list: InstanceItem[]): PageResult<InstanceItem> => ({
    data: list,
    total: list.length,
    success: true,
  })
  try {
    const res = await request.get(`/system/approval/instances/${tab}`, {
      params: tab === 'mine' ? { initiator: user } : { assignee: user },
    })
    const data = unwrap<any[] | { list: any[]; total?: number }>(
      res as Result<any[] | { list: any[]; total?: number }>,
    )
    const list = Array.isArray(data) ? data : (data.list ?? [])
    let templates: Map<number, TemplateDef> | null = null
    try {
      templates = await loadTemplateMap()
    } catch {
      // 模板名补全失败不阻断列表
    }
    return {
      data: list.map((i) => normalizeInstance(unwrapTaskView(i), templates)),
      total: Array.isArray(data) ? list.length : (data.total ?? list.length),
      success: true,
    }
  } catch {
    let list: InstanceItem[]
    if (tab === 'todo') list = filterByAssignee(user, false)
    else if (tab === 'done') list = filterByAssignee(user, true)
    else if (tab === 'cc') list = filterCc(user)
    else list = mockInstances.filter((i) => i.initiator === user)
    return fallback(`GET /system/approval/instances/${tab}`, wrap([...list]))
  }
}

export async function createInstance(payload: {
  templateCode: string
  businessKey: string
  title: string
  formData: Record<string, unknown>
}) {
  try {
    return await request.post('/system/approval/instances', payload)
  } catch {
    const template = mockTemplates.find((t) => t.code === payload.templateCode)
    const s = useAuthStore.getState()
    const initiator = s.realName || s.userName || '张三'
    const instance: InstanceItem = {
      id: nextInstanceId(),
      templateCode: payload.templateCode,
      templateName: template?.name ?? payload.templateCode,
      title: payload.title,
      businessKey: payload.businessKey,
      initiator,
      status: '审批中',
      currentNode: '部门负责人审批',
      formData: payload.formData,
      createdAt: now(),
      updatedAt: now(),
    }
    mockInstances.unshift(instance)
    mockTasks.push({
      id: nextTaskId(),
      instanceId: instance.id,
      nodeName: '部门负责人审批',
      nodeType: 'approver',
      assignee: '张三',
      status: '待处理',
      createdAt: now(),
    })
    return fallback('POST /system/approval/instances', { success: true, id: instance.id })
  }
}

/** 归一化进度节点：缺省字段兜底，assignees 强制数组 */
function normalizeProgress(raw: any): ProgressItem {
  return {
    nodeId: String(raw?.nodeId ?? raw?.id ?? ''),
    nodeName: raw?.nodeName ?? '',
    nodeType: raw?.nodeType ?? 'approver',
    signMode: raw?.signMode ?? undefined,
    assignees: Array.isArray(raw?.assignees) ? raw.assignees.map(String) : [],
    status: raw?.status ?? 'PENDING',
    comment: raw?.comment ?? undefined,
    actedAt: raw?.actedAt ?? raw?.finishedAt ?? undefined,
    branchName: raw?.branchName ?? null,
    origin: raw?.origin ?? undefined,
  }
}

export async function fetchInstanceDetail(id: number): Promise<InstanceDetail> {
  try {
    const res = await request.get(`/system/approval/instances/${id}`)
    const raw = unwrap<{
      instance: any
      tasks: any[]
      currentNode: any
      template: any
      formSchema: any
      progress: any[]
    }>(
      res as Result<{
        instance: any
        tasks: any[]
        currentNode: any
        template: any
        formSchema: any
        progress: any[]
      }>,
    )
    let templates: Map<number, TemplateDef> | null = null
    try {
      templates = await loadTemplateMap()
    } catch {
      // 模板名补全失败不阻断详情
    }
    const instance = normalizeInstance(raw?.instance ?? {}, templates)
    // 详情接口的 currentNode 可能是字符串或节点对象；为 null 表示流程已结束，保留归一化兜底值
    if (typeof raw?.currentNode === 'string' && raw.currentNode) {
      instance.currentNode = raw.currentNode
    } else if (raw?.currentNode && typeof raw.currentNode === 'object') {
      instance.currentNode =
        raw.currentNode.nodeName ?? raw.currentNode.name ?? instance.currentNode
    }
    const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : []).map(normalizeTask)
    // 模板：优先用接口返回的 {id,code,name}，旧接口缺省时从模板缓存按 templateId 补齐
    const tplHit = raw?.instance?.templateId != null ? templates?.get(raw.instance.templateId) : undefined
    const template =
      raw?.template != null
        ? { id: raw.template.id ?? 0, code: raw.template.code ?? '', name: raw.template.name ?? '' }
        : (tplHit ?? null)
    // formSchema 已是对象则原样透传，兼容个别实现仍返回 JSON 字符串的情况
    const formSchema = parseJson<InstanceDetail['formSchema']>(raw?.formSchema, null)
    // 旧接口没有 progress 字段：归一化为 []，前端降级用 tasks 渲染进度
    const progress = (Array.isArray(raw?.progress) ? raw.progress : []).map(normalizeProgress)
    return { instance, tasks, currentNode: instance.currentNode, template, formSchema, progress }
  } catch {
    const instance = mockInstances.find((i) => i.id === id)
    const tasks = mockTasks.filter((t) => t.instanceId === id)
    // mock 降级：补齐 template/formSchema 让只读回显走 schema 链路；progress 留空走 tasks 降级渲染
    const template = mockTemplates.find((t) => t.code === instance?.templateCode) ?? null
    const formSchema = mockForms.find((f) => f.id === template?.formId)?.schema ?? null
    return fallback(`GET /system/approval/instances/${id}`, {
      instance: instance as InstanceItem,
      tasks,
      currentNode: instance?.currentNode ?? '',
      template,
      formSchema,
      progress: [],
    })
  }
}

/** 审批联动（mock 降级）：更新任务与实例状态，流程推进到下一个待处理节点 */
function applyTaskResult(task: TaskItem, approved: boolean, comment: string) {
  task.status = approved ? '已同意' : '已驳回'
  task.comment = comment
  task.finishedAt = now()
  const instance = mockInstances.find((i) => i.id === task.instanceId)
  if (!instance) return
  instance.updatedAt = now()
  if (!approved) {
    instance.status = '已驳回'
    instance.currentNode = '流程结束'
  } else {
    const pending = mockTasks.find((t) => t.instanceId === instance.id && t.status === '待处理')
    if (pending) {
      instance.currentNode = pending.nodeName
    } else {
      instance.status = '已通过'
      instance.currentNode = '流程结束'
    }
  }
}

export async function approveTask(id: number, comment: string, formData?: Record<string, unknown>) {
  try {
    return await request.post(`/system/approval/tasks/${id}/approve`, { comment, formData })
  } catch {
    const task = mockTasks.find((t) => t.id === id)
    if (task) {
      applyTaskResult(task, true, comment)
      // mock 降级：审批人编辑过的字段值 merge 进实例 formData
      if (formData) {
        const instance = mockInstances.find((i) => i.id === task.instanceId)
        if (instance) instance.formData = { ...instance.formData, ...formData }
      }
    }
    return fallback(`POST /system/approval/tasks/${id}/approve`, { success: true })
  }
}

/** 驳回去向：end=直接驳回终止（默认）；prev=上一审批节点；node=指定前置节点；initiator=退回发起人 */
export type RejectTargetType = 'end' | 'prev' | 'node' | 'initiator'

export interface RejectPayload {
  comment: string
  targetType?: RejectTargetType
  /** targetType=node 时必填：目标节点 nodeId */
  targetNodeId?: string
}

export async function rejectTask(id: number, payload: RejectPayload) {
  const body = {
    comment: payload.comment,
    targetType: payload.targetType ?? 'end',
    targetNodeId: payload.targetNodeId,
  }
  try {
    return await request.post(`/system/approval/tasks/${id}/reject`, body)
  } catch {
    const task = mockTasks.find((t) => t.id === id)
    if (task) {
      if (body.targetType === 'end') {
        applyTaskResult(task, false, payload.comment)
      } else {
        mockRejectBack(id, {
          targetType: body.targetType,
          targetNodeId: body.targetNodeId,
          comment: payload.comment,
        })
      }
    }
    return fallback(`POST /system/approval/tasks/${id}/reject`, { success: true })
  }
}

/** 重新提交（仅发起人、仅「已退回」实例）；formData 缺省表示按原表单数据重新提交 */
export async function resubmit(instanceId: number, payload?: { formData?: Record<string, unknown> }) {
  try {
    return await request.post(`/system/approval/instances/${instanceId}/resubmit`, payload ?? {})
  } catch {
    mockResubmit(instanceId, payload?.formData)
    return fallback(`POST /system/approval/instances/${instanceId}/resubmit`, { success: true })
  }
}

// ---------------- 加签 ----------------

export interface AddSignPayload {
  /** before=前加签（我先不审，先由 TA 审）；after=后加签（我审完后由 TA 再审） */
  position: 'before' | 'after'
  assignee: string
  comment?: string
}

/** 加签：操作人须为该任务审批人；节点 allowAddSign=false 时后端会拒绝 */
export async function addSign(taskId: number, payload: AddSignPayload) {
  try {
    return await request.post(`/system/approval/tasks/${taskId}/add-sign`, payload)
  } catch {
    mockAddSign(taskId, payload)
    return fallback(`POST /system/approval/tasks/${taskId}/add-sign`, { success: true })
  }
}

/**
 * 加签人候选名单：真实接口 /system/users（取 realName/name/username），
 * 后端不可达时降级到流程设计器共用的 MEMBERS 名单。
 */
export async function fetchAssigneeOptions(): Promise<string[]> {
  try {
    const res = await request.get('/system/users', { params: { pageSize: 200 } })
    const data = unwrap<any>(res as Result<any>)
    const list: any[] = Array.isArray(data) ? data : (data?.list ?? data?.data ?? [])
    const names = list
      .map((u) => u?.realName ?? u?.name ?? u?.username)
      .filter((n): n is string => typeof n === 'string' && !!n)
    if (!names.length) throw new Error('empty user list')
    return [...new Set(names)]
  } catch {
    return fallback('GET /system/users', [...MEMBERS])
  }
}

/** 设计器成员选项：label 显示 realName（兜底 username），value 同 label */
export async function fetchUserOptions(): Promise<{ label: string; value: string }[]> {
  try {
    const res = await request.get('/system/users', { params: { pageSize: 200 } })
    const data = unwrap<any>(res as Result<any>)
    const list: any[] = Array.isArray(data) ? data : (data?.list ?? data?.data ?? [])
    const options = list
      .map((u) => {
        const name = u?.realName ?? u?.name ?? u?.username
        return typeof name === 'string' && name ? { label: name, value: name } : null
      })
      .filter((o): o is { label: string; value: string } => !!o)
    if (!options.length) throw new Error('empty user list')
    return options
  } catch {
    return fallback('GET /system/users', MEMBERS.map((m) => ({ label: m, value: m })))
  }
}

/** 设计器角色选项：label 显示角色中文名，value 存角色编码（与种子流程 approvers 一致） */
export async function fetchRoleOptions(): Promise<{ label: string; value: string }[]> {
  try {
    const res = await request.get('/system/roles', { params: { pageSize: 200 } })
    const data = unwrap<any>(res as Result<any>)
    const list: any[] = Array.isArray(data) ? data : (data?.list ?? data?.data ?? [])
    const options = list
      .filter((r) => r?.code && r?.name)
      .map((r) => ({ label: String(r.name), value: String(r.code) }))
    if (!options.length) throw new Error('empty role list')
    return options
  } catch {
    return fallback(
      'GET /system/roles',
      Object.entries(ROLE_DISPLAY).map(([code, name]) => ({ label: name, value: code })),
    )
  }
}

/**
 * 加签按钮可见性判定：按 nodeId 从模板 flowJson 里找节点配置，
 * allowAddSign===false 才隐藏；拿不到节点配置（含接口失败）默认允许。
 * nodeId 优先取任务自身字段，其次取进度链中该审批人的 CURRENT 节点。
 */
export async function resolveAllowAddSign(
  detail: InstanceDetail,
  task: TaskItem,
): Promise<boolean> {
  try {
    const nodeId =
      (task as TaskItem & { nodeId?: string }).nodeId ??
      (detail.progress.find(
        (p) => p.status === 'CURRENT' && p.assignees.includes(task.assignee),
      ) ??
        detail.progress.find((p) => p.status === 'CURRENT'))?.nodeId
    if (!nodeId) return true
    const templates = await loadTemplateMap()
    const tpl =
      (detail.template?.id != null ? templates.get(detail.template.id) : undefined) ??
      [...templates.values()].find(
        (t) => t.code === detail.template?.code || t.code === detail.instance.templateCode,
      )
    if (!tpl) return true
    const flows = await fetchFlows()
    const flow = flows.find((f) => f.id === tpl.flowId)
    if (!flow) return true
    const node = getNodeByPath(flow.flowJson, String(nodeId))
    if (!node) return true
    return node.allowAddSign !== false
  } catch {
    return true
  }
}

/**
 * 字段级审批权限解析：与 resolveAllowAddSign 同一路径（task.nodeId → 模板 flowJson → getNode），
 * 取节点 fieldPerms（key=字段编码，值 editable/hidden；未出现的字段=只读）。
 * 拿不到配置（含接口失败）返回 {}，审批中心保持全只读现状。
 */
export async function resolveFieldPerms(
  detail: InstanceDetail,
  task: TaskItem,
): Promise<Record<string, 'editable' | 'hidden'>> {
  try {
    const nodeId =
      (task as TaskItem & { nodeId?: string }).nodeId ??
      (detail.progress.find(
        (p) => p.status === 'CURRENT' && p.assignees.includes(task.assignee),
      ) ??
        detail.progress.find((p) => p.status === 'CURRENT'))?.nodeId
    if (!nodeId) return {}
    const templates = await loadTemplateMap()
    const tpl =
      (detail.template?.id != null ? templates.get(detail.template.id) : undefined) ??
      [...templates.values()].find(
        (t) => t.code === detail.template?.code || t.code === detail.instance.templateCode,
      )
    if (!tpl) return {}
    const flows = await fetchFlows()
    const flow = flows.find((f) => f.id === tpl.flowId)
    if (!flow) return {}
    const node = getNodeByPath(flow.flowJson, String(nodeId))
    return node?.fieldPerms ?? {}
  } catch {
    return {}
  }
}
