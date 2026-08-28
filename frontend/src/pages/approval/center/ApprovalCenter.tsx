/**
 * 审批中心：我的待办 / 我已办 / 我发起的 / 抄送我的。
 * 列表卡 + 详情 Drawer（头部 / 表单数据 / 审批进度节点链 / 操作区，四段式）。
 *
 * 进度数据源：详情接口的 progress（动作完整、按发生顺序：同一节点可能有多条
 * 同意/驳回/加签动作条目，英文状态枚举）；旧接口没有 progress 时归一化为 []，
 * 前端把 tasks 映射成同样的节点结构降级渲染，两种数据源共用一条渲染链路，都不白屏。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Drawer, Empty, Form, Input, Modal, Radio, Select, Spin, Tabs, Tag } from 'antd'
import { Check, CircleCheck, CircleX, Clock, GitBranch, RotateCcw, Send, User, UserPlus } from 'lucide-react'
import dayjs from 'dayjs'
import SchemaForm from '@/components/SchemaForm'
import { collectFields, isV2Schema } from '@/components/SchemaForm/model'
import {
  addSign,
  approveTask,
  ensureSystemToken,
  fetchAssigneeOptions,
  fetchInstanceDetail,
  fetchInstances,
  rejectTask,
  resolveAllowAddSign,
  resolveFieldPerms,
  resubmit,
  type InstanceTab,
  type RejectTargetType,
} from '@/api/approval'
import { currentUserName } from '@/api/approval'
import type {
  FormSchema,
  InstanceDetail,
  InstanceItem,
  ProgressItem,
  ProgressStatus,
  TaskItem,
} from '@/mocks/approval'
import './center.css'

const STATUS_TAG: Record<InstanceItem['status'], string> = {
  审批中: 'blue',
  已通过: 'green',
  已驳回: 'red',
  已撤销: 'default',
  已退回: 'warning',
}

/** 防御：列表数据万一漏归一化（英文枚举直出）时，展示层再翻一次中文 */
const INSTANCE_STATUS_TEXT: Record<string, string> = {
  PENDING: '审批中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  CANCELED: '已撤销',
  RETURNED: '已退回',
}

function statusText(status: string): string {
  return INSTANCE_STATUS_TEXT[status] ?? status
}

/** 兜底：归一化之外的状态值也不至于拿不到颜色 */
function statusTagOf(status: string): string {
  return STATUS_TAG[statusText(status) as InstanceItem['status']] ?? 'default'
}

const TAB_ITEMS: { key: InstanceTab; label: string }[] = [
  { key: 'todo', label: '我的待办' },
  { key: 'done', label: '我已办' },
  { key: 'mine', label: '我发起的' },
  { key: 'cc', label: '抄送我的' },
]

/* ================= 重新提交：表单值 date 互转 ================= */

/** schema 中的日期字段（v2 date/dateRange 与旧版 DatePicker/DateRange），编辑态需在字符串与 dayjs 间互转 */
function dateKeysOf(schema: InstanceDetail['formSchema']): { key: string; range: boolean }[] {
  if (!schema) return []
  if (isV2Schema(schema)) {
    return collectFields(schema.children)
      .filter((f) => f.type === 'date' || f.type === 'dateRange')
      .map((f) => ({ key: f.key, range: f.type === 'dateRange' }))
  }
  return Object.entries((schema as FormSchema).properties ?? {})
    .filter(([, p]) => p['x-component'] === 'DatePicker' || p['x-component'] === 'DateRange')
    .map(([key, p]) => ({ key, range: p['x-component'] === 'DateRange' }))
}

/** 表单数据 → 编辑态 initialValues：日期字符串转 dayjs */
function editValuesOf(
  schema: InstanceDetail['formSchema'],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...data }
  dateKeysOf(schema).forEach(({ key, range }) => {
    const v = values[key]
    if (range && Array.isArray(v)) values[key] = v.map((x) => (x ? dayjs(String(x)) : x))
    else if (!range && typeof v === 'string' && v) values[key] = dayjs(v)
  })
  return values
}

/** 编辑态提交值 → 表单数据：dayjs 转回 YYYY-MM-DD 字符串 */
function submitValuesOf(
  schema: InstanceDetail['formSchema'],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values }
  dateKeysOf(schema).forEach(({ key, range }) => {
    const v = out[key]
    if (range && Array.isArray(v)) {
      out[key] = v.map((x) => (dayjs.isDayjs(x) ? x.format('YYYY-MM-DD') : x))
    } else if (!range && dayjs.isDayjs(v)) {
      out[key] = v.format('YYYY-MM-DD')
    }
  })
  return out
}

/**
 * 重新提交弹窗内容：独立 useForm（每次打开都是新实例，initialValues 不会串上一条）。
 * formSchema 拿不到时降级：不允许编辑，按原 formData 直接重新提交。
 */
function ResubmitBody({
  detail,
  submitting,
  onCancel,
  onSubmit,
}: {
  detail: InstanceDetail | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (formData?: Record<string, unknown>) => void
}) {
  const [form] = Form.useForm()
  if (!detail) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Spin size="small" />
      </div>
    )
  }
  const schema = detail.formSchema
  if (!schema) {
    return (
      <>
        <div className="ac-resubmit-tip">
          未获取到表单 schema，不允许编辑；确认将按原表单数据重新提交？
        </div>
        <div className="ac-resubmit-btns">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => onSubmit()}>
            确认重新提交
          </Button>
        </div>
      </>
    )
  }
  return (
    <>
      <div className="ac-resubmit-tip">修改表单后重新提交，流程将重新开始审批。</div>
      <SchemaForm
        schema={schema}
        mode="edit"
        form={form}
        initialValues={editValuesOf(schema, detail.instance.formData)}
        onFinish={(values) => onSubmit(submitValuesOf(schema, values))}
      />
      <div className="ac-resubmit-btns">
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" loading={submitting} onClick={() => form.submit()}>
          提交
        </Button>
      </div>
    </>
  )
}

/* ================= 审批进度节点链 ================= */

/** 节点类型视觉：与流程设计器同一套语言（审批人蓝 / 抄送绿 / 条件琥珀） */
const NODE_TYPE_META = {
  approver: { icon: <User size={15} />, color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  cc: { icon: <Send size={15} />, color: 'var(--color-success)', bg: 'var(--success-light)' },
  condition: { icon: <GitBranch size={15} />, color: 'var(--color-warning)', bg: 'var(--warning-light)' },
} as const

/** 条目徽标文案：DONE/REJECTED 是动作语义（每条动作一条目），不是节点状态 */
const PROGRESS_BADGE: Record<ProgressStatus, string> = {
  DONE: '已同意',
  CURRENT: '审批中',
  PENDING: '未开始',
  REJECTED: '已驳回',
  CC: '已抄送',
  WAITING: '加签中',
  CANCELED: '已作废',
}

/** tasks（旧接口）→ 进度节点结构：中文任务状态映射为英文节点状态，共用渲染链路 */
function taskToProgress(t: TaskItem): ProgressItem {
  const status: ProgressStatus =
    t.status === '待处理'
      ? 'CURRENT'
      : t.status === '加签中'
        ? 'WAITING'
        : t.status === '已驳回'
          ? 'REJECTED'
          : t.status === '已抄送'
            ? 'CC'
            : t.status === '已作废'
              ? 'CANCELED'
              : 'DONE' // 已同意 / 已命中
  return {
    nodeId: String(t.id),
    nodeName: t.nodeName,
    nodeType: t.nodeType,
    assignees: t.nodeType === 'condition' ? [] : [t.assignee],
    status,
    comment: t.comment,
    actedAt: t.finishedAt,
    branchName: t.branchName ?? null,
    origin: t.origin,
  }
}

/** 单个进度节点：左侧类型图标 + 竖向连接线，右侧节点卡片 */
function ProgressNode({ item, last }: { item: ProgressItem; last: boolean }) {
  const meta = NODE_TYPE_META[item.nodeType] ?? NODE_TYPE_META.approver
  const signTag =
    item.nodeType === 'approver' && item.signMode
      ? item.signMode === 'all' || item.signMode === 'and'
        ? '会签'
        : '或签'
      : null
  const originTag =
    item.origin === 'ADD_BEFORE' ? '前加签' : item.origin === 'ADD_AFTER' ? '后加签' : null
  const statusCls = item.status.toLowerCase()
  return (
    <div className="ac-progress-node">
      <div className="ac-progress-rail">
        <span className="ac-node-icon" style={{ background: meta.bg, color: meta.color }}>
          {meta.icon}
        </span>
        {!last && <span className="ac-node-line" />}
      </div>
      <div className={`ac-node-card is-${statusCls}`}>
        <div className="ac-node-head">
          <span className="ac-node-name">{item.nodeName}</span>
          {originTag && <span className="ac-addsign-tag">{originTag}</span>}
          {signTag && <span className="ac-sign-tag">{signTag}</span>}
          <span className={`ac-badge ac-badge-${statusCls}`}>
            {item.status === 'CURRENT' && <span className="ac-badge-dot" />}
            {PROGRESS_BADGE[item.status] ?? item.status}
          </span>
        </div>
        {item.assignees.length > 0 && (
          <div className="ac-assignees">
            {item.assignees.map((name) => (
              <span key={name} className="ac-assignee">
                <span className="ac-avatar">{name.slice(0, 1)}</span>
                {name}
              </span>
            ))}
          </div>
        )}
        {item.nodeType === 'condition' && item.branchName && (
          <div className="ac-branch-hit">分支：{item.branchName}</div>
        )}
        {item.comment && (item.status === 'DONE' || item.status === 'REJECTED') && (
          <div className="ac-node-comment">{item.comment}</div>
        )}
        {item.actedAt && item.status !== 'PENDING' && (
          <div className="ac-node-time">{item.actedAt}</div>
        )}
      </div>
    </div>
  )
}

/** 审批进度卡：发起申请（固定首节点）+ 节点链 + 流程结束（实例已结束时） */
function ApprovalProgress({ detail }: { detail: InstanceDetail }) {
  const { instance } = detail
  let items = detail.progress.length > 0 ? detail.progress : detail.tasks.map(taskToProgress)
  const ended = instance.status !== '审批中'

  // 流程被驳回终止/撤销时，截断展示：终止点之后的「未开始」节点不再显示，避免误读为还会流转。
  // 截断点 = 最后一条 origin 为 NORMAL（缺省视为 NORMAL）的 REJECTED 动作条目；
  // 多条 REJECTED 动作时以最后一条为准，加签产生的驳回（origin 为 ADD_*）不作截断点。
  if (instance.status === '已驳回' || instance.status === '已撤销') {
    const liveRejectIdx = items.reduce(
      (acc, it, i) => (it.status === 'REJECTED' && (it.origin ?? 'NORMAL') === 'NORMAL' ? i : acc),
      -1,
    )
    if (liveRejectIdx >= 0) {
      items = items.filter(
        (it, i) => i <= liveRejectIdx || (it.status !== 'PENDING' && it.status !== 'CURRENT'),
      )
    }
  }

  const endText =
    instance.status === '已退回'
      ? '已退回发起人'
      : instance.status === '已驳回'
        ? '流程已终止'
        : instance.status === '已撤销'
          ? '流程已撤销'
          : '流程结束'

  return (
    <div className="ac-progress">
      {/* 首节点：发起申请 */}
      <div className="ac-progress-node">
        <div className="ac-progress-rail">
          <span
            className="ac-node-icon"
            style={{ background: 'var(--success-light)', color: 'var(--color-success)' }}
          >
            <Check size={15} />
          </span>
          <span className="ac-node-line" />
        </div>
        <div className="ac-start-node">
          <div className="ac-node-name">发起申请</div>
          <div className="ac-start-meta">
            {instance.initiator} · {instance.createdAt}
          </div>
        </div>
      </div>

      {items.map((item, i) => (
        // 同一 nodeId 可能有多条动作条目（同意/驳回/加签各一条），key 需带下标
        <ProgressNode
          key={item.nodeId ? `${item.nodeId}-${i}` : i}
          item={item}
          last={!ended && i === items.length - 1}
        />
      ))}

      {ended && (
        <div className="ac-progress-node">
          <div className="ac-progress-rail">
            <span className="ac-end-dot" />
          </div>
          <div className="ac-end-text">{endText}</div>
        </div>
      )}
    </div>
  )
}

/* ================= 页面 ================= */

export default function ApprovalCenter() {
  const { message } = App.useApp()
  const user = currentUserName()
  const [tab, setTab] = useState<InstanceTab>('todo')
  const [list, setList] = useState<InstanceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)
  // 驳回弹窗
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<RejectTargetType>('end')
  const [rejectNodeId, setRejectNodeId] = useState<string>()
  const [rejectComment, setRejectComment] = useState('')
  const [rejecting, setRejecting] = useState(false)
  // 重新提交弹窗
  const [resubmitTarget, setResubmitTarget] = useState<{
    instance: InstanceItem
    detail: InstanceDetail | null
  } | null>(null)
  const [resubmitting, setResubmitting] = useState(false)
  // 加签
  const [allowAddSign, setAllowAddSign] = useState(true)
  const [addSignOpen, setAddSignOpen] = useState(false)
  const [addSignPosition, setAddSignPosition] = useState<'before' | 'after'>('before')
  const [addSignAssignee, setAddSignAssignee] = useState<string>()
  const [addSignComment, setAddSignComment] = useState('')
  const [addSigning, setAddSigning] = useState(false)
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  // 字段级审批权限：当前待办节点的 fieldPerms（空对象=全只读，保持现状）
  const [fieldPerms, setFieldPerms] = useState<Record<string, 'editable' | 'hidden'>>({})
  const [approveForm] = Form.useForm()

  const loadList = useCallback(
    async (t: InstanceTab) => {
      setLoading(true)
      try {
        const res = await fetchInstances(t, user)
        setList(res.data)
      } finally {
        setLoading(false)
      }
    },
    [user],
  )

  useEffect(() => {
    ensureSystemToken()
  }, [])

  useEffect(() => {
    loadList(tab)
  }, [tab, loadList])

  const openDetail = async (item: InstanceItem) => {
    setDetailLoading(true)
    setComment('')
    try {
      const res = await fetchInstanceDetail(item.id)
      setDetail(res)
      // 加签按钮可见性：节点 allowAddSign===false 才隐藏，拿不到配置默认允许
      const mine = res.tasks.find((t) => t.status === '待处理' && t.assignee === user)
      if (mine) {
        setAllowAddSign(await resolveAllowAddSign(res, mine))
        // 字段权限：节点配了 fieldPerms 才切换为可编辑表单，否则保持全只读
        const perms = await resolveFieldPerms(res, mine)
        setFieldPerms(perms)
        // 清掉上一条详情的表单值，避免初始值串实例
        if (Object.keys(perms).length > 0) approveForm.resetFields()
      } else {
        setAllowAddSign(true)
        setFieldPerms({})
      }
    } finally {
      setDetailLoading(false)
    }
  }

  /** 当前登录人在该实例上的待处理任务 */
  const pendingTask = useMemo(
    () =>
      detail?.tasks.find((t) => t.status === '待处理' && t.assignee === user) ?? null,
    [detail, user],
  )

  const handleApprove = async () => {
    if (!pendingTask) return
    setActing(true)
    try {
      // 有可编辑字段时先把编辑过的表单值随同意提交（后端仅放行 editable 字段）
      let formData: Record<string, unknown> | undefined
      const schema = detail?.formSchema
      if (schema && Object.values(fieldPerms).includes('editable')) {
        const values = await approveForm.validateFields()
        // 防御：hidden/只读字段不渲染但值在 initialValues 里（Form preserve），
        // 万一被丢掉，用原 formData 对应 key 补回（编辑值优先）
        const merged = { ...editValuesOf(schema, detail!.instance.formData), ...values }
        formData = submitValuesOf(schema, merged)
      }
      await approveTask(pendingTask.id, comment.trim(), formData)
      message.success('已同意')
      setDetail(null)
      setFieldPerms({})
      loadList(tab)
    } finally {
      setActing(false)
    }
  }

  /* ---------------- 驳回（支持指定去向） ---------------- */

  const openReject = () => {
    setRejectTarget('end')
    setRejectNodeId(undefined)
    setRejectComment('')
    setRejectOpen(true)
  }

  /** 「驳回到指定节点」候选：已通过（DONE）的审批人节点；progress 缺失时走 tasks 降级映射。
   *  同一节点可能有多条 DONE 动作条目（动作按序各一条），候选按 nodeId 去重。 */
  const rejectNodeOptions = useMemo(() => {
    if (!detail) return []
    const items = detail.progress.length > 0 ? detail.progress : detail.tasks.map(taskToProgress)
    const seen = new Set<string>()
    return items
      .filter(
        (p) =>
          p.status === 'DONE' &&
          p.nodeType === 'approver' &&
          p.nodeId &&
          !seen.has(p.nodeId) &&
          (seen.add(p.nodeId), true),
      )
      .map((p) => ({
        label: `${p.nodeName}（${p.assignees.filter(Boolean).join('、') || '审批人'}）`,
        value: p.nodeId,
        nodeName: p.nodeName,
      }))
  }, [detail])

  const handleReject = async () => {
    if (!pendingTask) return
    if (!rejectComment.trim()) {
      message.warning('请填写审批意见')
      return
    }
    if (rejectTarget === 'node' && !rejectNodeId) {
      message.warning('请选择目标节点')
      return
    }
    setRejecting(true)
    try {
      await rejectTask(pendingTask.id, {
        comment: rejectComment.trim(),
        targetType: rejectTarget,
        targetNodeId: rejectTarget === 'node' ? rejectNodeId : undefined,
      })
      const targetNodeName = rejectNodeOptions.find((o) => o.value === rejectNodeId)?.nodeName
      message.success(
        rejectTarget === 'end'
          ? '已驳回，流程终止'
          : rejectTarget === 'prev'
            ? '已驳回至上一审批节点'
            : rejectTarget === 'node'
              ? `已驳回至「${targetNodeName ?? '目标节点'}」`
              : '已退回发起人',
      )
      setRejectOpen(false)
      setDetail(null)
      loadList(tab)
    } finally {
      setRejecting(false)
    }
  }

  /* ---------------- 重新提交（我发起的 · 已退回） ---------------- */

  const openResubmit = (item: InstanceItem) => {
    setResubmitTarget({ instance: item, detail: null })
    // 需要模板 formSchema + 最新 formData，列表行没有，统一拉详情
    fetchInstanceDetail(item.id).then((res) => {
      setResubmitTarget((cur) => (cur && cur.instance.id === item.id ? { ...cur, detail: res } : cur))
    })
  }

  const handleResubmit = async (formData?: Record<string, unknown>) => {
    if (!resubmitTarget) return
    setResubmitting(true)
    try {
      await resubmit(resubmitTarget.instance.id, formData ? { formData } : undefined)
      message.success('已重新提交')
      setResubmitTarget(null)
      setDetail(null)
      loadList(tab)
    } finally {
      setResubmitting(false)
    }
  }

  /** 详情抽屉里的「重新提交」入口：已退回且当前登录人是发起人 */
  const canResubmit =
    !!detail && detail.instance.status === '已退回' && detail.instance.initiator === user

  /** 无待办时的等待提示：取进度中的 CURRENT 节点，兜底实例 currentNode */
  const waitingHint = useMemo(() => {
    if (!detail || pendingTask || detail.instance.status !== '审批中') return null
    const items = detail.progress.length > 0 ? detail.progress : detail.tasks.map(taskToProgress)
    const current = items.find((p) => p.status === 'CURRENT')
    const nodeName = current?.nodeName || detail.instance.currentNode
    const assignees = current?.assignees.filter(Boolean).join('、') || '审批人'
    return { nodeName, assignees }
  }, [detail, pendingTask])

  /* ---------------- 加签 ---------------- */

  const openAddSign = () => {
    setAddSignPosition('before')
    setAddSignAssignee(undefined)
    setAddSignComment('')
    setAddSignOpen(true)
    // 候选人：/system/users 真实接口，失败时 api 层已降级到 MEMBERS
    fetchAssigneeOptions().then((list) => setAssigneeOptions(list.filter((n) => n !== user)))
  }

  const handleAddSign = async () => {
    if (!pendingTask) return
    if (!addSignAssignee) {
      message.warning('请选择加签人')
      return
    }
    setAddSigning(true)
    try {
      await addSign(pendingTask.id, {
        position: addSignPosition,
        assignee: addSignAssignee,
        comment: addSignComment.trim() || undefined,
      })
      message.success(
        addSignPosition === 'before'
          ? `已加签给 ${addSignAssignee}，待其处理`
          : `已同意并加签给 ${addSignAssignee}`,
      )
      setAddSignOpen(false)
      setDetail(null)
      loadList(tab)
    } finally {
      setAddSigning(false)
    }
  }

  const hasFormData = !!detail && Object.keys(detail.instance.formData ?? {}).length > 0

  return (
    <div className="approval-center">
      <div className="core-card ac-card">
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as InstanceTab)}
          items={TAB_ITEMS.map((t) => ({ ...t }))}
        />
        <Spin spinning={loading}>
          {list.length > 0 ? (
            <div className="ac-list">
              {list.map((item) => (
                <div key={item.id} className="ac-item" onClick={() => openDetail(item)}>
                  <div className="ac-item-main">
                    <div className="ac-item-title">{item.title}</div>
                    <div className="ac-item-meta">
                      <Tag color="purple">{item.templateName}</Tag>
                      <span>发起人：{item.initiator}</span>
                      <span>
                        <Clock size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                        {item.createdAt}
                      </span>
                    </div>
                  </div>
                  <div className="ac-item-side">
                    {tab === 'cc' && <span className="ac-cc-tag">抄送</span>}
                    {/* 抄送条目的 currentNode 是抄送节点名而非流程当前节点，不展示「当前节点」 */}
                    {tab !== 'cc' && statusText(item.status) === '审批中' && (
                      <span className="ac-item-node">当前节点：{item.currentNode}</span>
                    )}
                    {tab === 'mine' && statusText(item.status) === '已退回' && (
                      <Button
                        type="primary"
                        size="small"
                        icon={<RotateCcw size={13} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          openResubmit(item)
                        }}
                      >
                        重新提交
                      </Button>
                    )}
                    <Tag color={statusTagOf(item.status)}>{statusText(item.status)}</Tag>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="暂无数据" style={{ padding: '48px 0' }} />
          )}
        </Spin>
      </div>

      <Drawer
        open={!!detail || detailLoading}
        width={500}
        title="审批详情"
        onClose={() => setDetail(null)}
      >
        <Spin spinning={detailLoading}>
          {detail && (
            <div className="ac-detail">
              {/* 1. 头部：标题 + 状态 Tag + meta 行 */}
              <div className="ac-detail-head">
                <div className="ac-detail-title-row">
                  <h2 className="ac-detail-title">{detail.instance.title}</h2>
                  <Tag color={statusTagOf(detail.instance.status)}>
                    {statusText(detail.instance.status)}
                  </Tag>
                </div>
                <div className="ac-detail-meta">
                  {detail.template?.name || detail.instance.templateName} ·{' '}
                  {detail.instance.initiator} · {detail.instance.createdAt}
                  {detail.instance.businessKey && (
                    <span className="ac-business-key">{detail.instance.businessKey}</span>
                  )}
                </div>
              </div>

              {/* 2. 表单数据：节点配了字段权限时按权限渲染（可编辑/只读/隐藏），否则只读回显 */}
              <section className="ac-section">
                <h3 className="ac-section-title">表单数据</h3>
                {detail.formSchema && hasFormData ? (
                  pendingTask && Object.keys(fieldPerms).length > 0 ? (
                    <SchemaForm
                      schema={detail.formSchema}
                      mode="edit"
                      fieldPerms={fieldPerms}
                      form={approveForm}
                      initialValues={editValuesOf(detail.formSchema, detail.instance.formData)}
                    />
                  ) : (
                    <SchemaForm
                      schema={detail.formSchema}
                      mode="readonly"
                      initialValues={detail.instance.formData}
                    />
                  )
                ) : (
                  <div className="ac-empty-block">无表单数据</div>
                )}
              </section>

              {/* 3. 审批进度：节点链（progress 缺失时自动降级 tasks 渲染） */}
              <section className="ac-section">
                <h3 className="ac-section-title">审批进度</h3>
                <ApprovalProgress detail={detail} />
              </section>

              {/* 4. 操作区：仅当前用户有待处理任务时出现（驳回去向在弹窗内选择） */}
              {pendingTask && (
                <div className="ac-action-panel">
                  <div className="ac-action-title">审批意见</div>
                  <Input.TextArea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="填写审批意见（选填）"
                  />
                  <div className="ac-action-btns">
                    <Button danger icon={<CircleX size={14} />} onClick={openReject}>
                      驳回
                    </Button>
                    {allowAddSign && (
                      <Button icon={<UserPlus size={14} />} onClick={openAddSign}>
                        加签
                      </Button>
                    )}
                    <Button
                      type="primary"
                      icon={<CircleCheck size={14} />}
                      loading={acting}
                      onClick={handleApprove}
                    >
                      同意
                    </Button>
                  </div>
                </div>
              )}
              {waitingHint && (
                <div className="ac-action-hint">
                  <Send size={13} /> 当前节点「{waitingHint.nodeName}」· 等待{' '}
                  {waitingHint.assignees} 处理
                </div>
              )}
              {/* 已退回且我是发起人：重新提交入口（与列表卡片共用同一弹窗） */}
              {canResubmit && (
                <div className="ac-resubmit-entry">
                  <span>申请已被退回，可修改表单后重新提交</span>
                  <Button
                    type="primary"
                    size="small"
                    icon={<RotateCcw size={13} />}
                    onClick={() => openResubmit(detail.instance)}
                  >
                    重新提交
                  </Button>
                </div>
              )}
            </div>
          )}
        </Spin>
      </Drawer>

      {/* 加签弹窗：前加签（我先不审）/ 后加签（我审完后 TA 再审） */}
      <Modal
        open={addSignOpen}
        title="加签"
        okText="确认加签"
        cancelText="取消"
        confirmLoading={addSigning}
        onOk={handleAddSign}
        onCancel={() => setAddSignOpen(false)}
      >
        <div className="ac-addsign-form">
          <div className="ac-addsign-label">加签方式</div>
          <Radio.Group
            className="ac-addsign-radio"
            value={addSignPosition}
            onChange={(e) => setAddSignPosition(e.target.value as 'before' | 'after')}
          >
            <Radio value="before">
              <span className="ac-addsign-radio-title">前加签</span>
              <span className="ac-addsign-radio-desc">我先不审，先由 TA 审</span>
            </Radio>
            <Radio value="after">
              <span className="ac-addsign-radio-title">后加签</span>
              <span className="ac-addsign-radio-desc">我审完后由 TA 再审</span>
            </Radio>
          </Radio.Group>
          <div className="ac-addsign-label">选择加签人</div>
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder="搜索并选择加签人"
            value={addSignAssignee}
            onChange={(v) => setAddSignAssignee(v)}
            options={assigneeOptions.map((n) => ({ label: n, value: n }))}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
          <div className="ac-addsign-label">意见（选填）</div>
          <Input.TextArea
            rows={3}
            value={addSignComment}
            onChange={(e) => setAddSignComment(e.target.value)}
            placeholder="补充说明加签原因"
          />
        </div>
      </Modal>

      {/* 驳回弹窗：去向（终止/上一节点/指定节点/发起人）+ 必填审批意见 */}
      <Modal
        open={rejectOpen}
        title="驳回申请"
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        confirmLoading={rejecting}
        onOk={handleReject}
        onCancel={() => setRejectOpen(false)}
        destroyOnHidden
      >
        <div className="ac-addsign-form">
          <div className="ac-addsign-label">驳回去向</div>
          <Radio.Group
            className="ac-addsign-radio"
            value={rejectTarget}
            onChange={(e) => {
              setRejectTarget(e.target.value as RejectTargetType)
              setRejectNodeId(undefined)
            }}
          >
            <Radio value="end">
              <span className="ac-addsign-radio-title">直接驳回</span>
              <span className="ac-addsign-radio-desc">流程终止，不可恢复</span>
            </Radio>
            <Radio value="prev">
              <span className="ac-addsign-radio-title">驳回到上一审批节点</span>
              <span className="ac-addsign-radio-desc">退回上一位审批人重新审批</span>
            </Radio>
            <Radio value="node" disabled={rejectNodeOptions.length === 0}>
              <span className="ac-addsign-radio-title">驳回到指定节点</span>
              <span className="ac-addsign-radio-desc">选择已通过的前置审批节点，其后节点重新审批</span>
            </Radio>
            <Radio value="initiator">
              <span className="ac-addsign-radio-title">驳回到发起人</span>
              <span className="ac-addsign-radio-desc">发起人可修改表单后重新提交</span>
            </Radio>
          </Radio.Group>
          {rejectTarget === 'node' && (
            <>
              <div className="ac-addsign-label">目标节点</div>
              <Select
                style={{ width: '100%' }}
                placeholder="选择已通过（DONE）的审批节点"
                value={rejectNodeId}
                onChange={(v) => setRejectNodeId(v)}
                options={rejectNodeOptions}
              />
            </>
          )}
          <div className="ac-addsign-label">审批意见（必填）</div>
          <Input.TextArea
            rows={3}
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="请填写驳回原因"
          />
        </div>
      </Modal>

      {/* 重新提交弹窗：SchemaForm 编辑表单；schema 缺失时降级为按原数据确认提交 */}
      <Modal
        open={!!resubmitTarget}
        title="重新提交"
        footer={null}
        width={640}
        onCancel={() => setResubmitTarget(null)}
        destroyOnHidden
      >
        {resubmitTarget && (
          <ResubmitBody
            detail={resubmitTarget.detail}
            submitting={resubmitting}
            onCancel={() => setResubmitTarget(null)}
            onSubmit={handleResubmit}
          />
        )}
      </Modal>
    </div>
  )
}
