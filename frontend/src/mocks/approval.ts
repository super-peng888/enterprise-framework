/**
 * 审批演示 mock 数据：表单 / 流程 / 审批模板 / 审批实例与任务。
 * 与后端 schema.sql 种子一致：请假申请表单（LEAVE_APPLY）+ 请假审批流程 + 模板 LEAVE。
 * 后端未启动时由 src/api/approval.ts 降级到这里的数据。
 */
import type { FlowNode } from '@/pages/approval/designer/flow'
import type { FormSchemaV2 } from '@/components/SchemaForm/model'

/** Formily JSON Schema 属性 */
export interface SchemaProperty {
  type: string
  title: string
  required?: boolean
  'x-component': string
  'x-component-props'?: Record<string, unknown>
  /** 静态选项的另一种放法（部分存量 schema 用属性级 enum 而非 x-component-props.options） */
  enum?: { label: string; value: unknown }[]
  /** 栅格宽度（24=整行 / 12=二分之一 / 8=三分之一 / 6=四分之一），缺省 24 */
  'x-col-span'?: number
}

export interface FormSchema {
  type: 'object'
  properties: Record<string, SchemaProperty>
}

export interface FormDef {
  id: number
  /** 全局唯一编码：业务页面按 code 引用表单（如 LEAVE_APPLY） */
  code: string
  name: string
  /** 新版为 FormSchemaV2（version:2）；存量旧表单仍可能是 Formily 风格 FormSchema */
  schema: FormSchema | FormSchemaV2
  status: number
  updatedAt?: string
}

export interface FlowDef {
  id: number
  name: string
  flowJson: FlowNode[]
  status: number
  /** 关联表单 id：保存流程时非空则后端自动维护审批模板（FLOW_{id}） */
  formId?: number | null
}

export interface TemplateDef {
  id: number
  code: string
  name: string
  formId: number
  flowId: number
  status: number
}

export type InstanceStatus = '审批中' | '已通过' | '已驳回' | '已撤销' | '已退回'

export interface InstanceItem {
  id: number
  templateCode: string
  templateName: string
  title: string
  businessKey: string
  initiator: string
  status: InstanceStatus
  currentNode: string
  formData: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type TaskStatus = '待处理' | '加签中' | '已同意' | '已驳回' | '已抄送' | '已命中' | '已作废'

/** 任务来源：正常流转 / 前加签 / 后加签（驳回动作直接按序记 REJECTED 条目，不再有独立历史标记） */
export type TaskOrigin = 'NORMAL' | 'ADD_BEFORE' | 'ADD_AFTER'

export interface TaskItem {
  id: number
  instanceId: number
  nodeName: string
  nodeType: 'approver' | 'cc' | 'condition'
  assignee: string
  status: TaskStatus
  comment?: string
  /** 条件节点命中的分支名 */
  branchName?: string
  /** 加签产生的任务标记（缺省视为 NORMAL） */
  origin?: TaskOrigin
  /** 加签任务的来源任务 id（被加签挂起/触发的那条） */
  parentTaskId?: number
  createdAt: string
  finishedAt?: string
}

/** 审批进度节点状态（详情接口 progress 数组，英文枚举直传）；CANCELED=被回退作废的节点 */
export type ProgressStatus = 'DONE' | 'CURRENT' | 'PENDING' | 'REJECTED' | 'CC' | 'WAITING' | 'CANCELED'

/** 审批进度节点：按执行顺序的完整节点序列 */
export interface ProgressItem {
  nodeId: string
  nodeName: string
  nodeType: 'approver' | 'cc' | 'condition'
  /** 会签/或签（'all'/'and' → 会签，其余 → 或签），仅审批人节点有 */
  signMode?: string
  assignees: string[]
  status: ProgressStatus
  comment?: string
  actedAt?: string
  /** 条件节点命中的分支名 */
  branchName?: string | null
  /** 加签产生的进度节点标记（缺省视为 NORMAL） */
  origin?: TaskOrigin
}

export interface InstanceDetail {
  instance: InstanceItem
  tasks: TaskItem[]
  currentNode: string
  /** 实例所属模板（新版详情接口返回；旧接口缺省 null） */
  template: Pick<TemplateDef, 'id' | 'code' | 'name'> | null
  /** 已解析的表单 schema（v2 画布或旧 Formily 风格；旧接口缺省 null） */
  formSchema: FormDef['schema'] | null
  /** 按执行顺序的完整节点序列；旧接口没有该字段时归一化为 []，前端降级用 tasks 渲染 */
  progress: ProgressItem[]
}

// ---------------- 表单 ----------------

export const mockForms: FormDef[] = [
  {
    id: 1,
    code: 'LEAVE_APPLY',
    name: '请假申请',
    status: 1,
    updatedAt: '2026-08-10 10:00:00',
    // version 2 画布结构：字段与后端种子表单一致（leaveType/startDate/endDate/days/reason）
    schema: {
      version: 2,
      children: [
        {
          id: 'sec_base',
          kind: 'section',
          sectionType: 'group',
          title: '请假信息',
          children: [
            {
              id: 'f_leave_type',
              kind: 'field',
              type: 'select',
              key: 'leaveType',
              title: '请假类型',
              span: 2,
              required: true,
              placeholder: '请选择请假类型',
              options: [
                { label: '事假', value: '事假' },
                { label: '病假', value: '病假' },
                { label: '年假', value: '年假' },
                { label: '调休', value: '调休' },
              ],
            },
            {
              id: 'f_days',
              kind: 'field',
              type: 'number',
              key: 'days',
              title: '天数',
              span: 2,
              required: true,
              min: 0.5,
              max: 365,
            },
            {
              id: 'f_start_date',
              kind: 'field',
              type: 'date',
              key: 'startDate',
              title: '开始日期',
              span: 2,
              required: true,
            },
            {
              id: 'f_end_date',
              kind: 'field',
              type: 'date',
              key: 'endDate',
              title: '结束日期',
              span: 2,
              required: true,
            },
            {
              id: 'f_reason',
              kind: 'field',
              type: 'textarea',
              key: 'reason',
              title: '事由',
              span: 4,
              placeholder: '请说明请假事由',
              rows: 3,
            },
          ],
        },
      ],
    },
  },
]

// ---------------- 流程 ----------------

export const mockFlows: FlowDef[] = [
  {
    id: 1,
    name: '请假审批流程',
    status: 1,
    formId: 1,
    // 与后端种子一致：部门负责人审批 → 天数>3 总经理审批（默认空分支）→ 抄送
    flowJson: [
      {
        id: 'seed_approver_1',
        type: 'approver',
        name: '部门负责人审批',
        approverType: 'role',
        approvers: ['DEPT_LEADER'],
        signMode: 'or',
      },
      {
        id: 'seed_condition_1',
        type: 'condition',
        name: '请假天数判断',
        branches: [
          {
            id: 'seed_branch_1',
            name: '天数>3',
            isDefault: false,
            conditions: [{ id: 'seed_cond_1', field: 'days', op: '>', value: '3' }],
            children: [
              {
                id: 'seed_approver_2',
                type: 'approver',
                name: '总经理审批',
                approverType: 'member',
                approvers: ['张三'],
                signMode: 'or',
              },
            ],
          },
          {
            id: 'seed_branch_2',
            name: '其他',
            isDefault: true,
            conditions: [],
            children: [],
          },
        ],
      },
      {
        id: 'seed_cc_1',
        type: 'cc',
        name: '抄送',
        ccUsers: ['李四'],
      },
    ],
  },
]

// ---------------- 审批模板 ----------------

export const mockTemplates: TemplateDef[] = [
  { id: 1, code: 'LEAVE', name: '请假审批', formId: 1, flowId: 1, status: 1 },
]

// ---------------- 审批实例与任务 ----------------

export const mockInstances: InstanceItem[] = [
  {
    id: 1001,
    templateCode: 'LEAVE',
    templateName: '请假审批',
    title: '请假申请-李四-年假 5 天',
    businessKey: 'leave:1',
    initiator: '李四',
    status: '审批中',
    currentNode: '总经理审批',
    formData: {
      leaveType: '年假',
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      days: 5,
      reason: '家中有事，申请年假 5 天，工作已交接给同组同事。',
    },
    createdAt: '2026-08-12 10:24:00',
    updatedAt: '2026-08-12 15:02:00',
  },
  {
    id: 1002,
    templateCode: 'LEAVE',
    templateName: '请假审批',
    title: '请假申请-李四-事假 2 天',
    businessKey: 'leave:2',
    initiator: '李四',
    status: '已通过',
    currentNode: '流程结束',
    formData: {
      leaveType: '事假',
      startDate: '2026-08-06',
      endDate: '2026-08-07',
      days: 2,
      reason: '办理个人证件，需请假 2 天。',
    },
    createdAt: '2026-08-05 09:10:00',
    updatedAt: '2026-08-06 11:40:00',
  },
  {
    id: 1003,
    templateCode: 'LEAVE',
    templateName: '请假审批',
    title: '请假申请-李四-调休 1 天',
    businessKey: 'leave:3',
    initiator: '李四',
    status: '已驳回',
    currentNode: '流程结束',
    formData: {
      leaveType: '调休',
      startDate: '2026-08-15',
      endDate: '2026-08-15',
      days: 1,
      reason: '上周末加班，申请调休 1 天。',
    },
    createdAt: '2026-08-10 14:36:00',
    updatedAt: '2026-08-11 09:22:00',
  },
  {
    id: 1004,
    templateCode: 'LEAVE',
    templateName: '请假审批',
    title: '请假申请-李四-病假 4 天',
    businessKey: 'leave:4',
    initiator: '李四',
    status: '已退回',
    currentNode: '退回发起人',
    formData: {
      leaveType: '病假',
      startDate: '2026-08-18',
      endDate: '2026-08-21',
      days: 4,
      reason: '感冒发烧，申请病假 4 天，病假条待补充。',
    },
    createdAt: '2026-08-14 11:05:00',
    updatedAt: '2026-08-15 16:40:00',
  },
]

export const mockTasks: TaskItem[] = [
  // 实例 1001：审批中，待办落在「张三」（总经理审批节点）
  {
    id: 5001,
    instanceId: 1001,
    nodeName: '部门负责人审批',
    nodeType: 'approver',
    assignee: '张三',
    status: '已同意',
    comment: '同意，注意工作交接。',
    createdAt: '2026-08-12 10:24:00',
    finishedAt: '2026-08-12 15:02:00',
  },
  {
    id: 5002,
    instanceId: 1001,
    nodeName: '请假天数判断',
    nodeType: 'condition',
    assignee: '系统',
    status: '已命中',
    branchName: '天数>3',
    createdAt: '2026-08-12 15:02:00',
    finishedAt: '2026-08-12 15:02:00',
  },
  {
    id: 5003,
    instanceId: 1001,
    nodeName: '总经理审批',
    nodeType: 'approver',
    assignee: '张三',
    status: '待处理',
    createdAt: '2026-08-12 15:02:00',
  },
  // 实例 1002：已通过（天数≤3，走默认分支，部门负责人审批通过即结束）
  {
    id: 5004,
    instanceId: 1002,
    nodeName: '部门负责人审批',
    nodeType: 'approver',
    assignee: '张三',
    status: '已同意',
    comment: '同意。',
    createdAt: '2026-08-05 09:10:00',
    finishedAt: '2026-08-05 16:30:00',
  },
  // 实例 1003：已驳回
  {
    id: 5006,
    instanceId: 1003,
    nodeName: '部门负责人审批',
    nodeType: 'approver',
    assignee: '张三',
    status: '已驳回',
    comment: '调休额度不足，请核实后重新申请。',
    createdAt: '2026-08-10 14:36:00',
    finishedAt: '2026-08-11 09:22:00',
  },
  // 实例 1004：已退回发起人（驳回到发起人，待修改表单后重新提交）
  {
    id: 5007,
    instanceId: 1004,
    nodeName: '部门负责人审批',
    nodeType: 'approver',
    assignee: '张三',
    status: '已驳回',
    comment: '病假条未附，退回补充材料后重新提交。',
    createdAt: '2026-08-14 11:05:00',
    finishedAt: '2026-08-15 16:40:00',
  },
  // 实例 1002 的抄送任务（抄送给「李四」，供「抄送我的」列表降级展示）
  {
    id: 5008,
    instanceId: 1002,
    nodeName: '抄送',
    nodeType: 'cc',
    assignee: '李四',
    status: '已抄送',
    createdAt: '2026-08-06 11:40:00',
    finishedAt: '2026-08-06 11:40:00',
  },
]

let instanceSeq = 1004
let taskSeq = 5008

export function nextInstanceId(): number {
  return ++instanceSeq
}

export function nextTaskId(): number {
  return ++taskSeq
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

/**
 * 加签的本地模拟（后端未启动时由 api/approval.ts 降级调用）：
 * - 前加签：当前任务 → 加签中（被挂起），新插入一条加签人的待处理任务
 * - 后加签：当前任务 → 已同意，新增加签人的待处理任务（流程仍停在该节点）
 */
export function mockAddSign(
  taskId: number,
  payload: { position: 'before' | 'after'; assignee: string; comment?: string },
): boolean {
  const task = mockTasks.find((t) => t.id === taskId)
  if (!task || task.status !== '待处理') return false
  const instance = mockInstances.find((i) => i.id === task.instanceId)
  if (payload.position === 'before') {
    task.status = '加签中'
    if (payload.comment) task.comment = payload.comment
  } else {
    task.status = '已同意'
    task.comment = payload.comment
    task.finishedAt = now()
  }
  mockTasks.push({
    id: nextTaskId(),
    instanceId: task.instanceId,
    nodeName: task.nodeName,
    nodeType: 'approver',
    assignee: payload.assignee,
    status: '待处理',
    comment: payload.comment,
    origin: payload.position === 'before' ? 'ADD_BEFORE' : 'ADD_AFTER',
    parentTaskId: task.id,
    createdAt: now(),
  })
  if (instance) {
    instance.updatedAt = now()
    instance.currentNode = task.nodeName
  }
  return true
}

/**
 * 驳回到指定节点的本地模拟（后端未启动时由 api/approval.ts 降级调用）。
 * targetType：
 * - initiator：实例 → 已退回，待发起人修改表单后重新提交；
 * - prev / node：目标节点任务重新待处理，驳回任务记「已驳回」（意见留痕），
 *   其余未完成任务标「已作废」，实例保持审批中、currentNode 指向目标节点。
 * （targetType=end 直接驳回走 api 层 applyTaskResult，与本函数无关）
 */
export function mockRejectBack(
  taskId: number,
  payload: { targetType: 'prev' | 'node' | 'initiator'; targetNodeId?: string; comment: string },
): boolean {
  const task = mockTasks.find((t) => t.id === taskId)
  if (!task || task.status !== '待处理') return false
  const instance = mockInstances.find((i) => i.id === task.instanceId)
  if (!instance) return false

  // 驳回动作本身留痕：当前任务记「已驳回」+ 意见
  task.status = '已驳回'
  task.comment = payload.comment
  task.finishedAt = now()
  instance.updatedAt = now()

  if (payload.targetType === 'initiator') {
    instance.status = '已退回'
    instance.currentNode = '退回发起人'
    return true
  }

  // prev / node：定位目标节点任务（mock 里 progress 降级 tasks 渲染，nodeId 即任务 id）
  const instanceTasks = mockTasks.filter((t) => t.instanceId === instance.id)
  let target: TaskItem | undefined
  if (payload.targetType === 'node') {
    target = instanceTasks.find((t) => String(t.id) === payload.targetNodeId)
  } else {
    const idx = instanceTasks.findIndex((t) => t.id === task.id)
    target = instanceTasks
      .slice(0, idx)
      .reverse()
      .find((t) => t.nodeType === 'approver' && t.status === '已同意')
  }
  if (!target) return false

  // 目标节点重新待处理；其后未完成的任务作废（驳回任务自身保留「已驳回」留痕）
  target.status = '待处理'
  target.comment = undefined
  target.finishedAt = undefined
  target.createdAt = now()
  instanceTasks.forEach((t) => {
    if (t.id !== target.id && t.id !== task.id && (t.status === '待处理' || t.status === '加签中')) {
      t.status = '已作废'
      t.finishedAt = now()
    }
  })
  instance.status = '审批中'
  instance.currentNode = target.nodeName
  return true
}

/**
 * 重新提交的本地模拟（仅发起人、仅「已退回」实例）：
 * 实例回到审批中、流程从头开始（第一个审批节点重新待处理），formData 有传则覆盖。
 */
export function mockResubmit(instanceId: number, formData?: Record<string, unknown>): boolean {
  const instance = mockInstances.find((i) => i.id === instanceId)
  if (!instance || instance.status !== '已退回') return false
  if (formData) instance.formData = formData
  instance.status = '审批中'
  instance.currentNode = '部门负责人审批'
  instance.updatedAt = now()
  mockTasks.push({
    id: nextTaskId(),
    instanceId,
    nodeName: '部门负责人审批',
    nodeType: 'approver',
    assignee: '张三',
    status: '待处理',
    createdAt: now(),
  })
  return true
}
