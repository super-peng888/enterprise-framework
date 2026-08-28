/**
 * 表单设计器（设计视图）：顶部工具条 + 左控件面板 / 中自由栅格画布 / 右配置面板。
 *
 * 画布为 4 列栅格自由布局：字段 span 1-4 占列，一行最多 4 个字段；
 * 容器（分组 group / 块 block）可嵌套字段，块支持复制/移除。
 * 拖拽全部用 HTML5 原生 DnD（与 DataTable 列拖拽同款思路）：
 *   面板 → 画布空白（插到末尾）/ 字段上（插到其前/后）/ 容器内；
 *   画布内字段排序、跨容器移动；容器本身可拖拽排序；目标位置显示主色插入指示线。
 * schema 为 version 2 画布结构（见 src/components/SchemaForm/model.ts），
 * 旧版 Formily 风格 schema 载入时自动转换，保存即升级；预览用全局 SchemaForm 实时渲染。
 */
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Slider,
  Switch,
  Tag,
} from 'antd'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Boxes,
  Calendar,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleDot,
  Copy,
  Eraser,
  Eye,
  FlaskConical,
  GripVertical,
  Hash,
  Heading,
  Layers,
  ListChecks,
  ListFilter,
  MessageSquareWarning,
  Minus,
  Paperclip,
  Percent,
  Plus,
  Save,
  SlidersHorizontal,
  SquareCheck,
  SquareDashed,
  Star,
  Table,
  TextCursorInput,
  TextQuote,
  ToggleLeft,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import SchemaForm from '@/components/SchemaForm'
import {
  cloneSectionNode,
  collectFields,
  compileCustomPattern,
  createFieldNode,
  createSectionNode,
  dataSourceError,
  detachNode,
  FIELD_META,
  fieldKeyError,
  findNode,
  FORMAT_DEFAULT_MESSAGES,
  getByPath,
  insertNode,
  isDisplayType,
  isSelectType,
  LINK_OPS,
  patchFieldNode,
  patchSectionNode,
  resolveApiUrl,
  toCanvasChildren,
  type CanvasNode,
  type FieldNode,
  type FieldOption,
  type FieldType,
  type FieldValidation,
  type FormSchemaV2,
  type LinkRule,
  type SectionNode,
  type SubColumn,
  type ValidationFormat,
} from '@/components/SchemaForm/model'
import { validateFormula } from '@/components/SchemaForm/formula'
import { updateForm } from '@/api/approval'
import request from '@/api/request'
import type { FormDef } from '@/mocks/approval'
import './forms.css'

/* ---------------- 控件面板定义 ---------------- */

const FIELD_ICONS: Record<FieldType, ReactNode> = {
  input: <TextCursorInput size={15} />,
  textarea: <TextQuote size={15} />,
  number: <Hash size={15} />,
  money: <CircleDollarSign size={15} />,
  percent: <Percent size={15} />,
  select: <ListChecks size={15} />,
  selectSearch: <ListFilter size={15} />,
  multiSelect: <SquareCheck size={15} />,
  radio: <CircleDot size={15} />,
  checkbox: <CheckSquare size={15} />,
  date: <Calendar size={15} />,
  dateRange: <CalendarRange size={15} />,
  switch: <ToggleLeft size={15} />,
  rate: <Star size={15} />,
  slider: <SlidersHorizontal size={15} />,
  memberSelect: <UserRound size={15} />,
  upload: <Paperclip size={15} />,
  subTable: <Table size={15} />,
  placeholder: <SquareDashed size={15} />,
  divider: <Minus size={15} />,
  text: <MessageSquareWarning size={15} />,
  title: <Heading size={15} />,
}

type PaletteItem =
  | { kind: 'field'; fieldType: FieldType }
  | { kind: 'section'; sectionType: 'group' | 'block' }

interface PaletteGroup {
  name: string
  items: (PaletteItem & { label: string; icon: ReactNode })[]
}

const PALETTE: PaletteGroup[] = [
  {
    name: '布局容器',
    items: [
      { kind: 'section', sectionType: 'group', label: '分组', icon: <Layers size={15} /> },
      { kind: 'section', sectionType: 'block', label: '块', icon: <Boxes size={15} /> },
    ],
  },
  {
    name: '辅助',
    items: (['placeholder', 'divider', 'title', 'text'] as FieldType[]).map((t) => ({
      kind: 'field',
      fieldType: t,
      label: FIELD_META[t].label,
      icon: FIELD_ICONS[t],
    })),
  },
  {
    name: '输入',
    items: (['input', 'textarea', 'number', 'money', 'percent', 'switch', 'rate', 'slider'] as FieldType[]).map(
      (t) => ({ kind: 'field', fieldType: t, label: FIELD_META[t].label, icon: FIELD_ICONS[t] }),
    ),
  },
  {
    name: '选择',
    items: (
      ['select', 'selectSearch', 'multiSelect', 'radio', 'checkbox', 'memberSelect', 'date', 'dateRange', 'upload'] as FieldType[]
    ).map((t) => ({ kind: 'field', fieldType: t, label: FIELD_META[t].label, icon: FIELD_ICONS[t] })),
  },
  {
    name: '高级',
    items: (['subTable'] as FieldType[]).map((t) => ({
      kind: 'field',
      fieldType: t,
      label: FIELD_META[t].label,
      icon: FIELD_ICONS[t],
    })),
  },
]

/** 宽度 Segmented 选项（4 列栅格） */
const SPAN_OPTIONS = [
  { label: '一列', value: 1 },
  { label: '两列', value: 2 },
  { label: '三列', value: 3 },
  { label: '四列', value: 4 },
]

/* ---------------- 拖拽载荷 ---------------- */

type DragPayload =
  | { kind: 'widget'; item: PaletteItem }
  | { kind: 'node'; id: string; nodeKind: 'field' | 'section' }

/** 插入指示：targetId 为空表示插到容器/画布末尾 */
interface DropIndicator {
  containerId: string | null
  targetId: string | null
  before: boolean
}

/* ================= 字段配置面板（模块级组件，避免输入框失焦） ================= */

/** 明细子表子列受限类型 */
const SUB_COLUMN_TYPES: { value: SubColumn['type']; label: string }[] = [
  { value: 'input', label: '单行文本' },
  { value: 'number', label: '数字' },
  { value: 'money', label: '金额' },
  { value: 'percent', label: '百分比' },
  { value: 'select', label: '下拉选择' },
  { value: 'date', label: '日期' },
]

/** 明细子表：子列编辑器（增删 / 上下移 / 类型 / 必填 / 宽度 / select 选项） */
function SubColumnsConfig({ field, onPatch }: { field: FieldNode; onPatch: (patch: Partial<FieldNode>) => void }) {
  const cols = field.subColumns ?? []
  const patchCols = (next: SubColumn[]) => onPatch({ subColumns: next })
  const patchCol = (i: number, patch: Partial<SubColumn>) =>
    patchCols(cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  /** 数字系子列（可配行内公式） */
  const isNumericCol = (c: SubColumn) => ['number', 'money', 'percent'].includes(c.type)

  return (
    <div className="fd-form-item">
      <div className="fd-form-label">子列配置</div>
      {cols.map((col, i) => {
        const dupKey = !!col.key && cols.some((o, idx) => idx !== i && o.key === col.key)
        return (
          <div key={i} className="fd-subcol">
            <div className="fd-subcol-row">
              <Input
                size="small"
                placeholder="列标题"
                value={col.title}
                onChange={(e) => patchCol(i, { title: e.target.value })}
              />
              <Input
                size="small"
                placeholder="列 key"
                status={dupKey ? 'error' : undefined}
                value={col.key}
                onChange={(e) => patchCol(i, { key: e.target.value })}
              />
            </div>
            {dupKey && <div className="fd-field-error">子列 key 重复</div>}
            <div className="fd-subcol-row">
              <Select
                size="small"
                value={col.type}
                options={SUB_COLUMN_TYPES}
                onChange={(v) => patchCol(i, { type: v, ...(v === 'select' ? {} : { options: undefined }) })}
              />
              <InputNumber
                size="small"
                placeholder="宽度 px"
                min={60}
                max={600}
                value={col.width}
                onChange={(v) => patchCol(i, { width: v ?? undefined })}
              />
            </div>
            <div className="fd-subcol-row is-ops">
              <label className="fd-subcol-req">
                <Switch size="small" checked={!!col.required} onChange={(v) => patchCol(i, { required: v })} />
                必填
              </label>
              <div className="fd-option-ops">
                <button
                  type="button"
                  className="fd-mini-btn"
                  disabled={i === 0}
                  title="上移"
                  onClick={() => {
                    const next = [...cols]
                    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                    patchCols(next)
                  }}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="fd-mini-btn"
                  disabled={i === cols.length - 1}
                  title="下移"
                  onClick={() => {
                    const next = [...cols]
                    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                    patchCols(next)
                  }}
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  className="fd-mini-btn is-danger"
                  title="删除"
                  onClick={() => patchCols(cols.filter((_, idx) => idx !== i))}
                >
                  <Minus size={12} />
                </button>
              </div>
            </div>
            {/* 数字系子列：行内公式（仅提示不阻断保存，与自定义正则一致） */}
            {isNumericCol(col) && (
              <>
                <Input
                  size="small"
                  style={{ marginTop: 6 }}
                  placeholder="行内公式，如 quantity * price（可引用同行其他列 key）"
                  value={col.compute}
                  status={col.compute?.trim() && validateFormula(col.compute) ? 'error' : undefined}
                  onChange={(e) => patchCol(i, { compute: e.target.value.trim() || undefined })}
                />
                {col.compute?.trim() && validateFormula(col.compute) && (
                  <div className="fd-field-error">{validateFormula(col.compute)}</div>
                )}
              </>
            )}
            {col.type === 'select' && (
              <div className="fd-ds-body">
                {(col.options ?? []).map((opt, oi) => (
                  <div key={oi} className="fd-option-edit">
                    <Input
                      size="small"
                      placeholder="label"
                      value={opt.label}
                      onChange={(e) =>
                        patchCol(i, {
                          options: (col.options ?? []).map((o, j) => (j === oi ? { ...o, label: e.target.value } : o)),
                        })
                      }
                    />
                    <Input
                      size="small"
                      placeholder="value"
                      value={String(opt.value ?? '')}
                      onChange={(e) =>
                        patchCol(i, {
                          options: (col.options ?? []).map((o, j) => (j === oi ? { ...o, value: e.target.value } : o)),
                        })
                      }
                    />
                    <div className="fd-option-ops">
                      <button
                        type="button"
                        className="fd-mini-btn is-danger"
                        title="删除"
                        onClick={() => patchCol(i, { options: (col.options ?? []).filter((_, j) => j !== oi) })}
                      >
                        <Minus size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  block
                  icon={<Plus size={13} />}
                  onClick={() => {
                    const opts = col.options ?? []
                    patchCol(i, { options: [...opts, { label: `选项${opts.length + 1}`, value: `选项${opts.length + 1}` }] })
                  }}
                >
                  添加选项
                </Button>
              </div>
            )}
          </div>
        )
      })}
      <Button
        size="small"
        type="dashed"
        block
        icon={<Plus size={13} />}
        onClick={() => patchCols([...cols, { key: `col_${cols.length + 1}`, title: `列${cols.length + 1}`, type: 'input' }])}
      >
        添加子列
      </Button>
    </div>
  )
}

/** 联动规则行编辑器：字段（其他字段 key 下拉）+ 操作符 + 值，可增删 */
function LinkRulesEditor({
  label,
  rules,
  sourceFields,
  onChange,
}: {
  label: string
  rules: LinkRule[]
  sourceFields: FieldNode[]
  onChange: (next: LinkRule[]) => void
}) {
  const patchRule = (i: number, patch: Partial<LinkRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  return (
    <div className="fd-link-block">
      <div className="fd-form-label">{label}</div>
      {rules.map((r, i) => (
        <div key={i} className="fd-link-rule">
          <Select
            size="small"
            placeholder="字段"
            value={r.field || undefined}
            options={sourceFields.map((f) => ({ label: `${f.title || f.key}（${f.key}）`, value: f.key }))}
            onChange={(v) => patchRule(i, { field: v })}
          />
          <Select
            size="small"
            value={r.op}
            options={LINK_OPS.map((op) => ({ label: op, value: op }))}
            onChange={(v) => patchRule(i, { op: v })}
          />
          <Input size="small" placeholder="值" value={r.value} onChange={(e) => patchRule(i, { value: e.target.value })} />
          <button
            type="button"
            className="fd-mini-btn is-danger"
            title="删除规则"
            onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
          >
            <Minus size={12} />
          </button>
        </div>
      ))}
      <Button
        size="small"
        type="dashed"
        block
        icon={<Plus size={13} />}
        onClick={() => onChange([...rules, { field: sourceFields[0]?.key ?? '', op: '=', value: '' }])}
      >
        添加规则
      </Button>
    </div>
  )
}

interface FieldConfigProps {
  field: FieldNode
  allFields: FieldNode[]
  onPatch: (patch: Partial<FieldNode>) => void
}

function FieldConfig({ field, allFields, onPatch }: FieldConfigProps) {
  const { message } = App.useApp()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const keyErr = fieldKeyError(field, allFields)
  const dsErr = dataSourceError(field)
  const ds = field.dataSource ?? { mode: 'static' as const }
  const options = field.options ?? []
  const patchOptions = (next: FieldOption[]) => onPatch({ options: next })
  const patchDs = (patch: Partial<NonNullable<FieldNode['dataSource']>>) =>
    onPatch({ dataSource: { ...ds, ...patch } })

  const showPlaceholder = !isDisplayType(field.type) && field.type !== 'placeholder' && field.type !== 'subTable'
  const showRequired = !isDisplayType(field.type) && field.type !== 'placeholder'
  const showDefaultValue =
    !isDisplayType(field.type) && !['placeholder', 'upload', 'subTable'].includes(field.type)
  const showMinMax = field.type === 'number' || field.type === 'money' || field.type === 'percent'
  /** 校验配置：格式（input/textarea/number/money/percent）+ 长度（仅文本类） */
  const showValidation = ['input', 'textarea', 'number', 'money', 'percent'].includes(field.type)
  const showLengthLimit = field.type === 'input' || field.type === 'textarea'
  const val: FieldValidation = field.validation ?? {}
  const regexErr =
    val.format === 'custom' && val.regex?.trim() && !compileCustomPattern(val.regex)
      ? '正则表达式无效'
      : null
  /** 计算公式语法错误（仅提示不阻断保存，与自定义正则一致） */
  const computeErr = field.compute?.trim() ? validateFormula(field.compute) : null
  /** 合并校验配置并清理：无格式时正则/错误文案失去意义一并清掉；全空则存 undefined */
  const patchValidation = (patch: Partial<FieldValidation>) => {
    const next: FieldValidation = { ...val, ...patch }
    if (!next.format) {
      delete next.regex
      delete next.message
    } else if (next.format !== 'custom') {
      delete next.regex
    }
    if (next.message === '') delete next.message
    const empty = !next.format && next.minLength == null && next.maxLength == null
    onPatch({ validation: empty ? undefined : next })
  }
  /** 联动条件可选字段：当前表单其他字段（排除自身与展示型控件） */
  const linkSourceFields = allFields.filter((f) => f.id !== field.id && !isDisplayType(f.type))
  /** 规则为空数组 = 不配置（存 undefined，保持 schema 干净） */
  const patchRules = (prop: 'visibleWhen' | 'requiredWhen') => (next: LinkRule[]) =>
    onPatch({ [prop]: next.length ? next : undefined })

  /** 测试获取：实际请求接口，按点路径解析并展示前 3 条选项 */
  const handleTestApi = async () => {
    if (dsErr) {
      message.warning(dsErr)
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const body = await request.get(resolveApiUrl(ds.url!))
      const arr = getByPath(body, ds.resultPath)
      if (!Array.isArray(arr)) {
        setTestResult({ ok: false, text: `返回 JSON 中未找到数组：${ds.resultPath}` })
      } else if (!arr.length) {
        setTestResult({ ok: true, text: `请求成功，但 ${ds.resultPath} 数组为空` })
      } else {
        const preview = arr.slice(0, 3).map((item) => {
          const label = getByPath(item, ds.labelField)
          const value = getByPath(item, ds.valueField)
          return `${label ?? '(空)'} = ${JSON.stringify(value)}`
        })
        setTestResult({ ok: true, text: `共 ${arr.length} 条，前 ${preview.length} 条：\n${preview.join('\n')}` })
      }
    } catch (err) {
      setTestResult({
        ok: false,
        text: `请求失败：${err instanceof Error ? err.message : String(err)}\n（后端未启动时，渲染端将降级为空选项）`,
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      {/* 标题（占位符/分割线无标题） */}
      {field.type !== 'placeholder' && field.type !== 'divider' && (
        <div className="fd-form-item">
          <div className="fd-form-label">{field.type === 'title' ? '标题文字' : '标题'}</div>
          <Input value={field.title} onChange={(e) => onPatch({ title: e.target.value })} />
        </div>
      )}

      {/* 标题级别 */}
      {field.type === 'title' && (
        <div className="fd-form-item">
          <div className="fd-form-label">标题级别</div>
          <Segmented
            block
            value={field.level ?? 2}
            onChange={(v) => onPatch({ level: v as number })}
            options={[
              { label: '大', value: 1 },
              { label: '中', value: 2 },
              { label: '小', value: 3 },
            ]}
          />
        </div>
      )}

      {/* 提示文本内容 */}
      {field.type === 'text' && (
        <div className="fd-form-item">
          <div className="fd-form-label">提示内容</div>
          <Input.TextArea
            rows={3}
            value={field.tip}
            onChange={(e) => onPatch({ tip: e.target.value })}
          />
        </div>
      )}

      {/* 编码（纯展示控件自动生成，不可编辑） */}
      {!isDisplayType(field.type) && (
        <div className="fd-form-item">
          <div className="fd-form-label">编码（表单内唯一，小写下划线）</div>
          <Input
            value={field.key}
            status={keyErr ? 'error' : undefined}
            onChange={(e) => onPatch({ key: e.target.value })}
          />
          {keyErr && <div className="fd-field-error">{keyErr}</div>}
        </div>
      )}

      {/* 宽度：一列/两列/三列/四列 */}
      <div className="fd-form-item">
        <div className="fd-form-label">宽度</div>
        <Segmented
          block
          value={field.span}
          onChange={(v) => onPatch({ span: v as 1 | 2 | 3 | 4 })}
          options={SPAN_OPTIONS}
        />
        {field.type === 'placeholder' && (
          <Slider
            style={{ marginTop: 10 }}
            min={1}
            max={4}
            value={field.span}
            onChange={(v) => onPatch({ span: v as 1 | 2 | 3 | 4 })}
            marks={{ 1: '1', 2: '2', 3: '3', 4: '4' }}
          />
        )}
      </div>

      {/* 占位符高度 */}
      {field.type === 'placeholder' && (
        <div className="fd-form-item">
          <div className="fd-form-label">高度（{field.height ?? 80}px）</div>
          <Slider
            min={40}
            max={400}
            value={field.height ?? 80}
            onChange={(v) => onPatch({ height: v as number })}
          />
        </div>
      )}

      {showPlaceholder && (
        <div className="fd-form-item">
          <div className="fd-form-label">占位提示</div>
          <Input value={field.placeholder} onChange={(e) => onPatch({ placeholder: e.target.value })} />
        </div>
      )}

      {showRequired && (
        <div className="fd-form-item fd-form-inline">
          <div className="fd-form-label" style={{ marginBottom: 0 }}>
            是否必填
          </div>
          <Switch checked={!!field.required} onChange={(v) => onPatch({ required: v })} />
        </div>
      )}

      {showMinMax && (
        <div className="fd-form-item">
          <div className="fd-form-label">最小 / 最大值</div>
          <div className="fd-minmax">
            <InputNumber
              placeholder="最小值"
              value={field.min}
              onChange={(v) => onPatch({ min: v ?? undefined })}
            />
            <InputNumber
              placeholder="最大值"
              value={field.max}
              onChange={(v) => onPatch({ max: v ?? undefined })}
            />
          </div>
        </div>
      )}

      {field.type === 'textarea' && (
        <div className="fd-form-item">
          <div className="fd-form-label">行数</div>
          <InputNumber
            min={1}
            max={20}
            value={field.rows ?? 3}
            onChange={(v) => onPatch({ rows: v ?? 3 })}
          />
        </div>
      )}

      {/* 校验配置：格式 / 错误文案 / 长度（input/textarea/number/money/percent） */}
      {showValidation && (
        <div className="fd-form-item">
          <div className="fd-form-label">校验 · 格式</div>
          <Select
            size="small"
            value={val.format ?? ''}
            onChange={(v) => patchValidation({ format: (v || undefined) as ValidationFormat | undefined })}
            options={[
              { value: '', label: '无' },
              { value: 'phone', label: '手机号' },
              { value: 'email', label: '邮箱' },
              { value: 'idcard', label: '身份证' },
              { value: 'url', label: 'URL' },
              { value: 'custom', label: '自定义正则' },
            ]}
          />
          {val.format === 'custom' && (
            <>
              <Input
                size="small"
                style={{ marginTop: 8 }}
                placeholder="正则表达式"
                value={val.regex}
                status={regexErr ? 'error' : undefined}
                onChange={(e) => patchValidation({ regex: e.target.value || undefined })}
              />
              <div className="fd-ds-help">
                {'示例：^1[3-9]\\d{9}$（手机号）、^\\d{6}$（6 位数字验证码）'}
              </div>
              {regexErr && <div className="fd-field-error">{regexErr}</div>}
            </>
          )}
          {val.format && (
            <>
              <div className="fd-form-label" style={{ marginTop: 10 }}>
                错误文案
              </div>
              <Input
                size="small"
                placeholder={FORMAT_DEFAULT_MESSAGES[val.format]}
                value={val.message}
                onChange={(e) => patchValidation({ message: e.target.value || undefined })}
              />
            </>
          )}
          {showLengthLimit && (
            <>
              <div className="fd-form-label" style={{ marginTop: 10 }}>
                校验 · 最小 / 最大长度
              </div>
              <div className="fd-minmax">
                <InputNumber
                  size="small"
                  placeholder="最小长度"
                  min={0}
                  max={10000}
                  value={val.minLength}
                  onChange={(v) => patchValidation({ minLength: v ?? undefined })}
                />
                <InputNumber
                  size="small"
                  placeholder="最大长度"
                  min={0}
                  max={10000}
                  value={val.maxLength}
                  onChange={(v) => patchValidation({ maxLength: v ?? undefined })}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* 计算公式（number/money/percent）：值自动算出、只读不可手填 */}
      {showMinMax && (
        <div className="fd-form-item">
          <div className="fd-form-label">计算公式</div>
          <Input
            size="small"
            placeholder="如 price * count 或 SUM(detail.amount)"
            value={field.compute}
            status={computeErr ? 'error' : undefined}
            onChange={(e) => onPatch({ compute: e.target.value.trim() || undefined })}
          />
          <div className="fd-ds-help">
            支持 + - * / % ( ) 与字段编码；聚合函数 SUM / AVG / MIN / MAX /
            COUNT(子表.列)，如 SUM(detail.amount)。配置后该字段只读、随输入自动计算。
          </div>
          {computeErr && <div className="fd-field-error">{computeErr}</div>}
        </div>
      )}

      {/* select 系：数据源配置 */}
      {isSelectType(field.type) && (
        <div className="fd-form-item">
          <div className="fd-form-label">数据源</div>
          <Radio.Group
            block
            optionType="button"
            buttonStyle="solid"
            value={ds.mode}
            onChange={(e) => {
              setTestResult(null)
              patchDs({ mode: e.target.value as 'static' | 'api' })
            }}
            options={[
              { label: '静态选项', value: 'static' },
              { label: '接口获取', value: 'api' },
            ]}
          />

          {ds.mode === 'static' ? (
            <div className="fd-ds-body">
              {options.map((opt, oi) => (
                <div key={oi} className="fd-option-edit">
                  <Input
                    size="small"
                    placeholder="label"
                    value={opt.label}
                    onChange={(e) =>
                      patchOptions(options.map((o, i) => (i === oi ? { ...o, label: e.target.value } : o)))
                    }
                  />
                  <Input
                    size="small"
                    placeholder="value"
                    value={String(opt.value ?? '')}
                    onChange={(e) =>
                      patchOptions(options.map((o, i) => (i === oi ? { ...o, value: e.target.value } : o)))
                    }
                  />
                  <div className="fd-option-ops">
                    <button
                      type="button"
                      className="fd-mini-btn"
                      disabled={oi === 0}
                      title="上移"
                      onClick={() => {
                        const next = [...options]
                        ;[next[oi - 1], next[oi]] = [next[oi], next[oi - 1]]
                        patchOptions(next)
                      }}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      className="fd-mini-btn"
                      disabled={oi === options.length - 1}
                      title="下移"
                      onClick={() => {
                        const next = [...options]
                        ;[next[oi], next[oi + 1]] = [next[oi + 1], next[oi]]
                        patchOptions(next)
                      }}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      className="fd-mini-btn is-danger"
                      title="删除"
                      onClick={() => patchOptions(options.filter((_, i) => i !== oi))}
                    >
                      <Minus size={12} />
                    </button>
                  </div>
                </div>
              ))}
              <Button
                size="small"
                type="dashed"
                block
                icon={<Plus size={13} />}
                onClick={() =>
                  patchOptions([...options, { label: `选项${options.length + 1}`, value: `选项${options.length + 1}` }])
                }
              >
                添加选项
              </Button>
            </div>
          ) : (
            <div className="fd-ds-body">
              <div className="fd-form-label">接口地址</div>
              <Input
                size="small"
                placeholder="如 /system/users"
                value={ds.url}
                status={!ds.url?.trim() ? 'error' : undefined}
                onChange={(e) => patchDs({ url: e.target.value })}
              />
              <div className="fd-form-label" style={{ marginTop: 10 }}>
                结果取值路径
              </div>
              <Input
                size="small"
                placeholder="如 data.list"
                value={ds.resultPath}
                status={!ds.resultPath?.trim() ? 'error' : undefined}
                onChange={(e) => patchDs({ resultPath: e.target.value })}
              />
              <div className="fd-ds-help">从返回 JSON 的哪个字段取数组，支持 a.b.c 点路径</div>
              <div className="fd-form-label" style={{ marginTop: 10 }}>
                label 字段 / value 字段
              </div>
              <div className="fd-minmax">
                <Input
                  size="small"
                  placeholder="label 字段"
                  value={ds.labelField}
                  status={!ds.labelField?.trim() ? 'error' : undefined}
                  onChange={(e) => patchDs({ labelField: e.target.value })}
                />
                <Input
                  size="small"
                  placeholder="value 字段"
                  value={ds.valueField}
                  status={!ds.valueField?.trim() ? 'error' : undefined}
                  onChange={(e) => patchDs({ valueField: e.target.value })}
                />
              </div>
              <Button
                size="small"
                block
                style={{ marginTop: 10 }}
                icon={<FlaskConical size={13} />}
                loading={testing}
                onClick={handleTestApi}
              >
                测试获取
              </Button>
              {testResult && (
                <pre className={`fd-ds-test ${testResult.ok ? 'is-ok' : 'is-err'}`}>{testResult.text}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {showDefaultValue && (
        <div className="fd-form-item">
          <div className="fd-form-label">默认值</div>
          <Input
            value={field.defaultValue as string | undefined}
            placeholder="留空则无默认值"
            onChange={(e) => onPatch({ defaultValue: e.target.value || undefined })}
          />
        </div>
      )}

      {/* 明细子表：子列编辑器 */}
      {field.type === 'subTable' && <SubColumnsConfig field={field} onPatch={onPatch} />}

      {/* 联动配置：显示条件 / 必填条件（多规则为「且」关系） */}
      {!isDisplayType(field.type) && field.type !== 'placeholder' && (
        <div className="fd-form-item">
          <div className="fd-form-label">联动配置</div>
          <LinkRulesEditor
            label="显示条件（全部命中时显示，留空恒显示）"
            rules={field.visibleWhen ?? []}
            sourceFields={linkSourceFields}
            onChange={patchRules('visibleWhen')}
          />
          <LinkRulesEditor
            label="必填条件（全部命中时必填，留空不联动）"
            rules={field.requiredWhen ?? []}
            sourceFields={linkSourceFields}
            onChange={patchRules('requiredWhen')}
          />
        </div>
      )}
    </>
  )
}

/* ================= 主组件 ================= */

interface FormDesignerProps {
  /** 正在设计的表单（切换表单时由父级用 key 重挂载） */
  form: FormDef
  onBack: () => void
  onSaved: () => void
}

export default function FormDesigner({ form, onBack, onSaved }: FormDesignerProps) {
  const { message } = App.useApp()
  const [formName, setFormName] = useState(form.name)
  const [formStatus, setFormStatus] = useState(form.status)
  const [children, setChildren] = useState<CanvasNode[]>(() => toCanvasChildren(form.schema))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drag, setDrag] = useState<DragPayload | null>(null)
  const [indicator, setIndicator] = useState<DropIndicator | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [previewForm] = Form.useForm()

  const schema: FormSchemaV2 = useMemo(() => ({ version: 2, children }), [children])
  const allFields = useMemo(() => collectFields(children), [children])
  const selected = selectedId ? findNode(children, selectedId) : null

  const clearDrag = () => {
    setDrag(null)
    setIndicator(null)
  }

  /* ---------------- 面板 ---------------- */

  const addFromPalette = (item: PaletteItem) => {
    const node = item.kind === 'field' ? createFieldNode(item.fieldType) : createSectionNode(item.sectionType)
    setChildren((prev) => [...prev, node])
    setSelectedId(node.id)
  }

  /* ---------------- 节点操作 ---------------- */

  const patchField = (id: string, patch: Partial<FieldNode>) =>
    setChildren((prev) => patchFieldNode(prev, id, patch))

  /* ---------------- 字段宽度拖拽（吸附 4 列栅格） ---------------- */
  const resizeState = useRef<{ id: string; startX: number; startSpan: number; colWidth: number } | null>(null)

  const startWidthResize = (field: FieldNode, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const gridEl = (e.currentTarget as HTMLElement).closest('.fd-canvas-grid') as HTMLElement | null
    if (!gridEl) return
    resizeState.current = {
      id: field.id,
      startX: e.clientX,
      startSpan: field.span,
      colWidth: gridEl.clientWidth / 4,
    }
    const onMove = (ev: MouseEvent) => {
      const s = resizeState.current
      if (!s) return
      // 按列宽换算增量并取整 = 吸附到 1-4 列
      const deltaCols = Math.round((ev.clientX - s.startX) / s.colWidth)
      const next = Math.min(4, Math.max(1, s.startSpan + deltaCols)) as 1 | 2 | 3 | 4
      patchField(s.id, { span: next })
    }
    const onUp = () => {
      resizeState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const patchSection = (id: string, patch: Partial<SectionNode>) =>
    setChildren((prev) => patchSectionNode(prev, id, patch))

  const removeNode = (id: string) => {
    if (selectedId === id) setSelectedId(null)
    setChildren((prev) => detachNode(prev, id)[0])
  }

  const copySection = (section: SectionNode) => {
    const copy = cloneSectionNode(section)
    setChildren((prev) => {
      const idx = prev.findIndex((n) => n.id === section.id)
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
    setSelectedId(copy.id)
  }

  /* ---------------- 拖拽 ---------------- */

  /** 字段卡片 dragOver：计算插到该字段前/后（按鼠标横向位置） */
  const handleFieldDragOver = (e: React.DragEvent, field: FieldNode, containerId: string | null) => {
    if (!drag) return
    if (drag.kind === 'node' && drag.nodeKind === 'section') return // 容器不能进容器
    if (drag.kind === 'node' && drag.id === field.id) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const before = e.clientX < rect.left + rect.width / 2
    setIndicator({ containerId, targetId: field.id, before })
  }

  /** 容器 body dragOver：追加到容器末尾 */
  const handleSectionBodyDragOver = (e: React.DragEvent, section: SectionNode) => {
    if (!drag) return
    if (drag.kind === 'node' && drag.nodeKind === 'section') return
    if (drag.kind === 'widget' && drag.item.kind === 'section') return
    e.preventDefault()
    e.stopPropagation()
    setIndicator({ containerId: section.id, targetId: null, before: false })
  }

  /** 画布空白 dragOver：追加到顶层末尾（子元素 dragOver 均已 stopPropagation） */
  const handleCanvasDragOver = (e: React.DragEvent) => {
    if (!drag) return
    e.preventDefault()
    setIndicator({ containerId: null, targetId: null, before: false })
  }

  /** 统一 drop：按 indicator 落点插入（面板新控件或画布内移动） */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ind = indicator
    const payload = drag
    clearDrag()
    if (!payload) return

    // 容器只能放在画布顶层
    const targetContainer =
      payload.kind === 'widget' && payload.item.kind === 'section' ? null : (ind?.containerId ?? null)
    const targetId = targetContainer === ind?.containerId ? (ind?.targetId ?? null) : null
    const before = ind?.before ?? false

    setChildren((prev) => {
      let tree = prev
      let node: CanvasNode
      if (payload.kind === 'widget') {
        node = payload.item.kind === 'field' ? createFieldNode(payload.item.fieldType) : createSectionNode(payload.item.sectionType)
      } else {
        const [next, removed] = detachNode(tree, payload.id)
        if (!removed) return prev
        tree = next
        node = removed
      }
      // 计算落点下标
      const list: CanvasNode[] = targetContainer
        ? ((findNode(tree, targetContainer) as SectionNode | null)?.children ?? [])
        : tree
      let index = list.length
      if (targetId) {
        const idx = list.findIndex((n) => n.id === targetId)
        if (idx >= 0) index = before ? idx : idx + 1
      }
      const result = insertNode(tree, node, targetContainer, index)
      if (payload.kind === 'widget') setSelectedId(node.id)
      return result
    })
  }

  /** 容器标题栏 dragOver：容器排序 / 面板容器插到某节点前 */
  const handleSectionHeadDragOver = (e: React.DragEvent, section: SectionNode) => {
    if (!drag) return
    if (drag.kind === 'node' && drag.id === section.id) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    setIndicator({ containerId: null, targetId: section.id, before })
  }

  const startNodeDrag = (e: React.DragEvent, node: CanvasNode) => {
    e.dataTransfer.setData('text/plain', node.id)
    e.dataTransfer.effectAllowed = 'move'
    setDrag({ kind: 'node', id: node.id, nodeKind: node.kind })
    setIndicator(null)
  }

  const startWidgetDrag = (e: React.DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData('text/plain', 'widget')
    e.dataTransfer.effectAllowed = 'copy'
    setDrag({ kind: 'widget', item })
    setIndicator(null)
  }

  /* ---------------- 保存 / 校验 ---------------- */

  const handleSave = async () => {
    if (!formName.trim()) {
      message.warning('请填写表单名称')
      return
    }
    if (!allFields.length) {
      message.warning('表单至少需要一个字段')
      return
    }
    for (const f of allFields) {
      const err = fieldKeyError(f, allFields)
      if (err) {
        setSelectedId(f.id)
        message.error(`字段「${f.title || f.key}」编码有误：${err}`)
        return
      }
    }
    for (const f of allFields) {
      const err = dataSourceError(f)
      if (err) {
        setSelectedId(f.id)
        message.error(`字段「${f.title || f.key}」接口数据源：${err}`)
        return
      }
    }
    for (const f of allFields) {
      if (f.type !== 'subTable') continue
      const cols = f.subColumns ?? []
      const keys = cols.map((c) => c.key.trim())
      const err = !cols.length
        ? '请至少配置一个子列'
        : keys.some((k) => !k)
          ? '子列 key 不能为空'
          : new Set(keys).size !== keys.length
            ? '子列 key 不能重复'
            : null
      if (err) {
        setSelectedId(f.id)
        message.error(`子表「${f.title || f.key}」：${err}`)
        return
      }
    }
    setSaving(true)
    try {
      await updateForm(form.id, { name: formName, status: formStatus, schema })
      message.success('表单已保存')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- 画布渲染 ---------------- */

  const renderFieldCard = (field: FieldNode, containerId: string | null) => {
    const isSelected = field.id === selectedId
    const isDropTarget = indicator?.targetId === field.id
    const meta = FIELD_META[field.type]
    return (
      <div key={field.id} className="fd-grid-item" style={{ gridColumn: `span ${field.span}` }}>
        <div
          className={[
            'fd-field-card',
            isSelected ? 'is-selected' : '',
            field.type === 'placeholder' ? 'is-placeholder' : '',
            drag?.kind === 'node' && drag.id === field.id ? 'is-dragging' : '',
            isDropTarget ? (indicator!.before ? 'drop-before' : 'drop-after') : '',
          ].join(' ')}
          onClick={(e) => {
            e.stopPropagation()
            setSelectedId(field.id)
          }}
          onDragOver={(e) => handleFieldDragOver(e, field, containerId)}
          onDrop={handleDrop}
        >
          <span
            className="fd-drag-handle"
            title="拖拽排序"
            draggable
            onDragStart={(e) => startNodeDrag(e, field)}
            onDragEnd={clearDrag}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </span>
          <div className="fd-field-main">
            <div className="fd-field-title">
              {field.type === 'placeholder' ? (
                <span className="fd-placeholder-text">占位符 · 高 {field.height ?? 80}px</span>
              ) : field.type === 'divider' ? (
                <span className="fd-placeholder-text">分割线</span>
              ) : (
                <>
                  {field.title || meta.label}
                  {field.required && <span className="fd-field-required">*</span>}
                </>
              )}
            </div>
            <div className="fd-field-meta">
              {meta.label} · {field.span}/4 列
              {!isDisplayType(field.type) && ` · ${field.key}`}
              {isSelectType(field.type) && field.dataSource?.mode === 'api' && ' · 接口数据源'}
              {field.compute && ' · ƒx 自动计算'}
            </div>
          </div>
          <button
            type="button"
            className="fd-field-close"
            title="删除"
            onClick={(e) => {
              e.stopPropagation()
              removeNode(field.id)
            }}
          >
            <X size={13} />
          </button>
          {/* 宽度拖拽手柄：拖右缘按列宽吸附调整占比（1-4 列） */}
          <span
            className="fd-width-resizer"
            title="拖拽调整宽度"
            onMouseDown={(e) => startWidthResize(field, e)}
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          />
        </div>
      </div>
    )
  }

  const renderSection = (section: SectionNode) => {
    const isSelected = section.id === selectedId
    const isDropTarget = indicator?.targetId === section.id && !indicator?.containerId
    const bodyTargeted = indicator?.containerId === section.id && !indicator?.targetId
    return (
      <div
        key={section.id}
        className={[
          'fd-section',
          `is-${section.sectionType}`,
          isSelected ? 'is-selected' : '',
          drag?.kind === 'node' && drag.id === section.id ? 'is-dragging' : '',
          isDropTarget ? (indicator!.before ? 'drop-before' : 'drop-after') : '',
        ].join(' ')}
        onDrop={handleDrop}
      >
        <div
          className="fd-section-head"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedId(section.id)
          }}
          onDragOver={(e) => handleSectionHeadDragOver(e, section)}
        >
          <span
            className="fd-drag-handle"
            title="拖拽排序"
            draggable
            onDragStart={(e) => startNodeDrag(e, section)}
            onDragEnd={clearDrag}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </span>
          {section.sectionType === 'group' ? <Layers size={14} /> : <Boxes size={14} />}
          <span className="fd-section-title">{section.title || (section.sectionType === 'group' ? '分组' : '块')}</span>
          <Tag className="fd-section-tag">{section.sectionType === 'group' ? '分组' : '块'}</Tag>
          <div className="fd-section-actions" onClick={(e) => e.stopPropagation()}>
            {section.sectionType === 'block' && (
              <button type="button" className="fd-field-btn" title="复制" onClick={() => copySection(section)}>
                <Copy size={13} />
              </button>
            )}
            <button
              type="button"
              className="fd-field-btn is-danger"
              title="移除"
              onClick={() => removeNode(section.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <div
          className={['fd-section-body', bodyTargeted ? 'drop-inside' : ''].join(' ')}
          onDragOver={(e) => handleSectionBodyDragOver(e, section)}
          onDrop={handleDrop}
        >
          {section.children.length ? (
            section.children.map((f) => renderFieldCard(f, section.id))
          ) : (
            <div className="fd-section-empty">拖入字段</div>
          )}
        </div>
      </div>
    )
  }

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="form-designer page-fill">
      {/* 顶部工具条 */}
      <div className="core-card fd-toolbar">
        <div className="fd-toolbar-left">
          <Button icon={<ArrowLeft size={14} />} onClick={onBack}>
            返回列表
          </Button>
          <span className="fd-toolbar-label">表单名称</span>
          <Input value={formName} onChange={(e) => setFormName(e.target.value)} style={{ width: 200 }} />
          <span className="fd-toolbar-label">Code</span>
          <Input value={form.code} disabled style={{ width: 160 }} />
        </div>
        <div className="fd-toolbar-right">
          <Popconfirm
            title="确认清空画布？"
            description="将移除全部字段与容器"
            okText="清空"
            cancelText="取消"
            onConfirm={() => {
              setChildren([])
              setSelectedId(null)
            }}
          >
            <Button icon={<Eraser size={14} />}>清空</Button>
          </Popconfirm>
          <Button icon={<Eye size={14} />} onClick={() => setPreviewOpen(true)}>
            预览
          </Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} onClick={handleSave}>
            保存
          </Button>
        </div>
      </div>

      <div className="fd-body">
        {/* 左：控件面板（分组折叠，点击或拖拽加入画布） */}
        <div className="core-card fd-panel">
          <div className="fd-panel-title">控件面板</div>
          {PALETTE.map((group) => {
            const isCollapsed = !!collapsed[group.name]
            return (
              <div key={group.name} className="fd-palette-group">
                <div
                  className="fd-palette-head"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [group.name]: !prev[group.name] }))}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span>{group.name}</span>
                </div>
                {!isCollapsed && (
                  <div className="fd-widget-grid">
                    {group.items.map((item) => (
                      <div
                        key={item.label}
                        className="fd-widget"
                        draggable
                        onDragStart={(e) => startWidgetDrag(e, item)}
                        onDragEnd={clearDrag}
                        onClick={() => addFromPalette(item)}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="fd-panel-tip">点击或拖拽控件到画布</div>
        </div>

        {/* 中：画布（4 列栅格） */}
        <div
          className={[
            'core-card fd-canvas',
            indicator && !indicator.targetId && !indicator.containerId ? 'drop-end' : '',
          ].join(' ')}
          onDragOver={handleCanvasDragOver}
          onDrop={handleDrop}
          onClick={() => setSelectedId(null)}
        >
          {children.length > 0 ? (
            <div className="fd-canvas-grid">
              {children.map((n) => (n.kind === 'section' ? renderSection(n) : renderFieldCard(n, null)))}
            </div>
          ) : (
            <div className="fd-canvas-empty">
              <SquareDashed size={32} />
              <div>从左侧拖入控件，或点击控件添加到画布</div>
              <div className="fd-canvas-empty-sub">4 列栅格布局，字段可占 1-4 列；容器内同样是 4 列栅格</div>
            </div>
          )}
        </div>

        {/* 右：配置面板（随选中切换） */}
        <div className="core-card fd-config">
          {!selected && (
            <>
              <div className="fd-panel-title">表单属性</div>
              <div className="fd-form-item">
                <div className="fd-form-label">表单名称</div>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="fd-form-item">
                <div className="fd-form-label">表单 Code</div>
                <Input value={form.code} disabled />
              </div>
              <div className="fd-form-item fd-form-inline">
                <div className="fd-form-label" style={{ marginBottom: 0 }}>
                  状态（启用）
                </div>
                <Switch
                  checked={formStatus === 1}
                  onChange={(v) => setFormStatus(v ? 1 : 0)}
                />
              </div>
            </>
          )}

          {selected?.kind === 'section' && (
            <>
              <div className="fd-panel-title">
                {selected.sectionType === 'group' ? '分组配置' : '块配置'}
              </div>
              <div className="fd-form-item">
                <div className="fd-form-label">标题</div>
                <Input
                  value={selected.title}
                  onChange={(e) => patchSection(selected.id, { title: e.target.value })}
                />
              </div>
              <div className="fd-panel-tip">
                容器内为 4 列栅格，可从面板或画布拖入字段
                {selected.sectionType === 'block' && '；块支持复制 / 移除'}
              </div>
            </>
          )}

          {selected?.kind === 'field' && (
            <>
              <div className="fd-panel-title">{FIELD_META[selected.type].label}配置</div>
              <FieldConfig
                key={selected.id}
                field={selected}
                allFields={allFields}
                onPatch={(patch) => patchField(selected.id, patch)}
              />
            </>
          )}
        </div>
      </div>

      {/* 预览 Modal：按当前画布 schema 实时渲染，可交互 */}
      <Modal
        open={previewOpen}
        title={`表单预览 · ${formName}`}
        width={720}
        okText="提交"
        cancelText="关闭"
        destroyOnHidden
        onCancel={() => setPreviewOpen(false)}
        onOk={() => previewForm.submit()}
      >
        <SchemaForm
          schema={schema}
          mode="edit"
          form={previewForm}
          onFinish={(values) => {
            message.success('预览提交成功，数据见控制台')
            console.log('[表单预览提交]', values)
            setPreviewOpen(false)
          }}
        />
        {!allFields.length && <Empty description="表单暂无字段" />}
      </Modal>
    </div>
  )
}
