/**
 * 发起审批：模板卡片网格 + 发起弹窗。
 * 卡片展示模板名 / 关联表单名 / 流程名；点「发起」弹出标题 + SchemaForm（按模板
 * 关联表单的 code 加载，edit 模式），提交 POST /system/approval/instances。
 * 后端不可达时 api 层自动降级 mock（mockTemplates/mockForms + mock createInstance）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Empty, Form, Input, Modal, Spin, Tooltip } from 'antd'
import { PlayCircle } from 'lucide-react'
import SchemaForm from '@/components/SchemaForm'
import {
  createInstance,
  ensureSystemToken,
  fetchFlows,
  fetchForms,
  fetchTemplates,
} from '@/api/approval'
import { useAuthStore } from '@/stores/auth'
import type { FlowDef, FormDef, TemplateDef } from '@/mocks/approval'
import './launch.css'

export default function Launch() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { userName, realName } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<TemplateDef[]>([])
  const [forms, setForms] = useState<FormDef[]>([])
  const [flows, setFlows] = useState<FlowDef[]>([])
  const [launching, setLaunching] = useState<TemplateDef | null>(null)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    ensureSystemToken()
    Promise.all([fetchTemplates(), fetchForms(), fetchFlows()])
      .then(([t, f, fl]) => {
        setTemplates(t)
        setForms(f)
        setFlows(fl)
      })
      .finally(() => setLoading(false))
  }, [])

  /** 仅展示启用状态的模板 */
  const enabledTemplates = useMemo(() => templates.filter((t) => t.status === 1), [templates])

  const formOf = (tpl: TemplateDef) => forms.find((f) => f.id === tpl.formId) ?? null
  const flowOf = (tpl: TemplateDef) => flows.find((f) => f.id === tpl.flowId) ?? null

  const openLaunch = (tpl: TemplateDef) => {
    setLaunching(tpl)
    setTitle(`${tpl.name}-${realName || userName || '发起人'}`)
    form.resetFields()
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!launching) return
    if (!title.trim()) {
      message.warning('请填写审批标题')
      return
    }
    setSubmitting(true)
    try {
      await createInstance({
        templateCode: launching.code,
        title: title.trim(),
        businessKey: `manual:${Date.now()}`,
        formData: values,
      })
      message.success('已提交，可在审批中心-我发起的查看')
      setLaunching(null)
      navigate('/approval/center')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="launch-page">
      <div className="core-card launch-head">
        <div className="launch-title">发起审批</div>
        <div className="launch-desc">选择一个审批模板，填写表单后提交审批</div>
      </div>

      {loading ? (
        <div className="launch-loading">
          <Spin />
        </div>
      ) : enabledTemplates.length === 0 ? (
        <div className="core-card launch-empty">
          <Empty description="暂无可用审批模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div className="launch-grid">
          {enabledTemplates.map((tpl) => {
            const tplForm = formOf(tpl)
            const tplFlow = flowOf(tpl)
            const disabled = !tplForm
            const card = (
              <div className={`core-card launch-card ${disabled ? 'is-disabled' : ''}`}>
                <div className="launch-card-icon">
                  <PlayCircle size={18} />
                </div>
                <div className="launch-card-name">{tpl.name}</div>
                <div className="launch-card-meta">
                  <div>表单：{tplForm?.name ?? '未关联表单'}</div>
                  <div>流程：{tplFlow?.name ?? `#${tpl.flowId}`}</div>
                </div>
                <Button
                  type="primary"
                  block
                  disabled={disabled}
                  onClick={() => openLaunch(tpl)}
                >
                  发起
                </Button>
              </div>
            )
            return disabled ? (
              <Tooltip key={tpl.id} title="该模板未关联表单，无法发起">
                {card}
              </Tooltip>
            ) : (
              <div key={tpl.id}>{card}</div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!launching}
        title={launching ? `发起：${launching.name}` : ''}
        width={720}
        okText="提交"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => form.submit()}
        onCancel={() => setLaunching(null)}
        destroyOnHidden
      >
        <div className="launch-modal-title">
          <div className="launch-modal-label">审批标题</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="请输入审批标题" />
        </div>
        {launching && formOf(launching) && (
          <SchemaForm
            formCode={formOf(launching)!.code}
            mode="edit"
            form={form}
            onSubmit={handleSubmit}
          />
        )}
      </Modal>
    </div>
  )
}
