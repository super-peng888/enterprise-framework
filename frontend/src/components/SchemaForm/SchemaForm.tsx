/**
 * 全局 Schema 表单渲染器。
 *
 * 表单中心使用约定：
 *   任何业务页面需要表单时，先在「审批管理 → 表单中心」配置表单，
 *   再用 <SchemaForm formCode="LEAVE_APPLY" mode="edit" onSubmit={...} /> 按 code 引用，
 *   后续调整表单（增删字段/改宽度/改选项）不需要改业务代码。
 *   设计器预览等场景也可以直接传 schema：<SchemaForm schema={...} mode="edit" />。
 *
 * 双 schema 分支：
 *   1. version 2 画布结构（见 ./model.ts）：容器（分组/块）+ 4 列栅格，
 *      select 系支持接口数据源（dataSource.mode='api' 时挂载后按 url 拉取，
 *      用 resultPath 点路径取数组，labelField/valueField 映射选项）；
 *   2. 旧版 Formily 风格（{type:'object',properties:{...}}）：按原 x-component
 *      映射 fallback 渲染，保证存量表单不破。
 *
 * 未引入 @formily/react + @formily/antd-v5：其对 antd 6 的兼容性未验证
 * （@formily/antd-v5 peer 依赖 antd ^5），为避免构建/运行风险，
 * 用约百行代码手写 x-component → antd 组件的映射，覆盖本项目全部控件。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Radio,
  Rate,
  Row,
  Select,
  Slider,
  Spin,
  Switch,
  Table,
  Typography,
  Upload,
} from 'antd'
import type { FormInstance } from 'antd'
import type { Rule } from 'antd/es/form'
import type { ColumnsType } from 'antd/es/table'
import type dayjs from 'dayjs'
import { Plus, Trash2, Upload as UploadIcon } from 'lucide-react'
import { fetchFormByCode } from '@/api/approval'
import request from '@/api/request'
import type { FormSchema, SchemaProperty } from '@/mocks/approval'
import { MEMBERS } from '@/pages/approval/designer/flow'
import type { FieldNode, FieldOption, FormSchemaV2, SectionNode, SubColumn } from './model'
import { compileCustomPattern, collectFields, evalLinkRules, FORMAT_DEFAULT_MESSAGES, FORMAT_PATTERNS, getByPath, isSelectType, isV2Schema ,
  resolveApiUrl,
} from './model'
import { evalFormula } from './formula'

interface SchemaFormProps {
  /** 直接传 schema 渲染（优先级高于 formCode），支持 v2 画布结构与旧版 Formily 风格 */
  schema?: FormSchema | FormSchemaV2
  /** 表单中心的全局 code，内部按 code 拉取启用表单的 schema */
  formCode?: string
  /** edit：可交互表单；readonly：只读回显 */
  mode: 'edit' | 'readonly'
  form?: FormInstance
  initialValues?: Record<string, unknown>
  /**
   * 字段级审批权限（仅 v2 schema 的 edit 模式生效）：key=字段编码。
   * 'editable'=可编辑；'hidden'=不渲染（值由 initialValues 保留提交）；
   * 未出现在 map 里的字段渲染为只读文本回显（不包 Form.Item）。不传则全部可编辑。
   */
  fieldPerms?: Record<string, 'editable' | 'hidden'>
  onFinish?: (values: Record<string, unknown>) => void
  /** onFinish 的别名，业务页面按 code 引用时推荐用这个 */
  onSubmit?: (values: Record<string, unknown>) => void
}

type Props = Record<string, unknown>

/* ================= v2：接口数据源取数 ================= */

/** 按 dataSource 配置取选项：静态直接返回；api 模式挂载后发请求，失败降级空选项 */
function useFieldOptions(field: FieldNode): FieldOption[] {
  const dsKey = JSON.stringify(field.dataSource ?? null)
  const [options, setOptions] = useState<FieldOption[]>(field.options ?? [])
  useEffect(() => {
    const ds = field.dataSource
    if (!isSelectType(field.type) || !ds || ds.mode !== 'api') {
      setOptions(field.options ?? [])
      return
    }
    if (!ds.url) {
      setOptions([])
      return
    }
    let cancelled = false
    request
      .get(resolveApiUrl(ds.url))
      .then((body) => {
        if (cancelled) return
        const arr = getByPath(body, ds.resultPath)
        if (!Array.isArray(arr)) {
          console.warn(`[SchemaForm] 字段「${field.title}」接口返回中未找到数组：${ds.resultPath}`)
          setOptions([])
          return
        }
        setOptions(
          arr.map((item) => ({
            label: String(getByPath(item, ds.labelField) ?? ''),
            value: getByPath(item, ds.valueField),
          })),
        )
      })
      .catch((err) => {
        if (cancelled) return
        console.warn(`[SchemaForm] 字段「${field.title}」选项接口请求失败（${ds.url}）`, err)
        setOptions([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id, dsKey])
  return options
}

/** 成员选择：拉 /system/users，失败降级本地 MEMBERS 名单 */
function useMemberOptions(): FieldOption[] {
  const [options, setOptions] = useState<FieldOption[]>(
    MEMBERS.map((m) => ({ label: m, value: m })),
  )
  useEffect(() => {
    let cancelled = false
    request
      .get('/system/users')
      .then((body) => {
        if (cancelled) return
        const arr = (getByPath(body, 'data.list') ?? getByPath(body, 'data')) as unknown
        if (!Array.isArray(arr) || !arr.length) return
        setOptions(
          arr.map((u) => {
            const name = String(getByPath(u, 'name') ?? getByPath(u, 'username') ?? '')
            return { label: name, value: name }
          }),
        )
      })
      .catch(() => {
        // 后端未启动：保持本地 MEMBERS 降级
      })
    return () => {
      cancelled = true
    }
  }, [])
  return options
}

/* ================= v2：控件映射 ================= */

/** 控件必须透传 Form.Item 注入的 props（value/checked/fileList/onChange），否则输入注册不进表单 */
type InjectedProps = {
  value?: any
  checked?: boolean
  fileList?: any
  onChange?: (...args: any[]) => void
}

function ApiSelect({ field, multiple, ...rest }: { field: FieldNode; multiple?: boolean } & InjectedProps) {
  const options = useFieldOptions(field)
  return (
    <Select
      {...rest}
      mode={multiple ? 'multiple' : undefined}
      placeholder={field.placeholder}
      options={options as { label: string; value: never }[]}
      showSearch={field.type === 'selectSearch'}
      optionFilterProp="label"
      allowClear
    />
  )
}

function MemberSelect({ placeholder, ...rest }: { placeholder?: string } & InjectedProps) {
  const options = useMemberOptions()
  return (
    <Select
      {...rest}
      mode="multiple"
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      options={options}
      allowClear
    />
  )
}

const normUploadFile = (e: unknown) => {
  if (Array.isArray(e)) return e
  return (e as { fileList?: unknown[] })?.fileList
}

/* ================= v2：明细子表 ================= */

type SubRow = Record<string, unknown>

/** 子表单元格编辑器（按子列类型渲染受限控件） */
function SubCellEditor({
  col,
  value,
  onChange,
}: {
  col: SubColumn
  value: unknown
  onChange: (v: unknown) => void
}) {
  switch (col.type) {
    case 'number':
      return (
        <InputNumber size="small" style={{ width: '100%' }} value={value as number | undefined} onChange={onChange} disabled={!!col.compute} />
      )
    case 'money':
      return (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          prefix="¥"
          min={0}
          precision={2}
          value={value as number | undefined}
          onChange={onChange}
          disabled={!!col.compute}
        />
      )
    case 'percent':
      return (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          addonAfter="%"
          min={0}
          max={100}
          value={value as number | undefined}
          onChange={onChange}
          disabled={!!col.compute}
        />
      )
    case 'select':
      return (
        <Select
          size="small"
          style={{ width: '100%' }}
          options={col.options as { label: string; value: never }[] | undefined}
          allowClear
          value={value as string | undefined}
          onChange={onChange}
        />
      )
    case 'date':
      return (
        <DatePicker
          size="small"
          style={{ width: '100%' }}
          value={value as dayjs.Dayjs | undefined}
          onChange={onChange}
        />
      )
    case 'input':
    default:
      return <Input size="small" value={value as string | undefined} onChange={(e) => onChange(e.target.value)} />
  }
}

/** 明细子表（edit 模式）：可编辑表格，值为行对象数组（按子列 key），由 Form.Item 注入 value/onChange */
function SubTableControl({
  field,
  value,
  onChange,
}: {
  field: FieldNode
  value?: SubRow[]
  onChange?: (v: SubRow[]) => void
}) {
  // 行内公式的点路径/兜底要查顶层表单值：从所在 Form 实例取（SubTableControl 必渲染在 Form 内）
  const formInst = Form.useFormInstance()
  const rows: SubRow[] = Array.isArray(value) ? value : []
  const cols = field.subColumns ?? []
  const computeCols = cols.filter((c) => c.compute)

  /** 行内公式重算：scope=当前行，点路径查顶层表单值；两轮遍历兜底（行内公式引用另一计算列时第一轮可能读到旧值） */
  const recalcRow = (row: SubRow): SubRow => {
    if (!computeCols.length) return row
    let next = row
    for (let round = 0; round < 2; round++) {
      const top = (formInst?.getFieldsValue(true) ?? {}) as Record<string, unknown>
      for (const c of computeCols) {
        const val = evalFormula(c.compute!, next, top)
        // money 列结果保留两位小数，避免提交 33.3333333 这类长尾值
        const v = c.type === 'money' && val !== null ? Math.round(val * 100) / 100 : val
        if (v !== next[c.key]) next = { ...next, [c.key]: v ?? undefined }
      }
    }
    return next
  }

  const patchRow = (i: number, key: string, v: unknown) =>
    onChange?.(rows.map((r, idx) => (idx === i ? recalcRow({ ...r, [key]: v }) : r)))

  const columns: ColumnsType<SubRow> = [
    { title: '序号', width: 52, render: (_v, _r, i) => i + 1 },
    ...cols.map((c) => ({
      title: (
        <span>
          {c.required && <span style={{ color: 'var(--color-danger)' }}>* </span>}
          {c.title}
        </span>
      ),
      dataIndex: c.key,
      width: c.width,
      render: (_v: unknown, row: SubRow, i: number) => (
        <SubCellEditor col={c} value={row[c.key]} onChange={(v) => patchRow(i, c.key, v)} />
      ),
    })),
    {
      title: '',
      width: 44,
      render: (_v, _r, i) => (
        <Button
          type="text"
          size="small"
          danger
          title="删除此行"
          icon={<Trash2 size={13} />}
          onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
        />
      ),
    },
  ]

  return (
    <div className="schema-form-subtable">
      <Table
        size="small"
        bordered
        pagination={false}
        rowKey={(_r, i) => String(i)}
        columns={columns}
        dataSource={rows}
      />
      <Button
        type="dashed"
        block
        size="small"
        style={{ marginTop: 8 }}
        icon={<Plus size={13} />}
        onClick={() => onChange?.([...rows, recalcRow({})])}
      >
        添加一行
      </Button>
    </div>
  )
}

/** v2 字段 → 表单控件 */
function FieldControl({ field, ...rest }: { field: FieldNode } & InjectedProps) {
  switch (field.type) {
    case 'textarea':
      return <Input.TextArea {...rest} placeholder={field.placeholder} rows={field.rows ?? 3} />
    case 'number':
      return (
        <InputNumber
          {...rest}
          style={{ width: '100%' }}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          disabled={!!field.compute}
        />
      )
    case 'money':
      return (
        <InputNumber
          {...rest}
          style={{ width: '100%' }}
          placeholder={field.placeholder}
          prefix="¥"
          min={field.min ?? 0}
          max={field.max}
          precision={2}
          disabled={!!field.compute}
        />
      )
    case 'percent':
      return (
        <InputNumber
          {...rest}
          style={{ width: '100%' }}
          placeholder={field.placeholder}
          addonAfter="%"
          min={field.min ?? 0}
          max={field.max ?? 100}
          disabled={!!field.compute}
        />
      )
    case 'select':
    case 'selectSearch':
      return <ApiSelect {...rest} field={field} />
    case 'multiSelect':
      return <ApiSelect {...rest} field={field} multiple />
    case 'radio':
      return <RadioGroupWithOptions {...rest} field={field} />
    case 'checkbox':
      return <CheckboxGroupWithOptions {...rest} field={field} />
    case 'date':
      return <DatePicker {...rest} style={{ width: '100%' }} placeholder={field.placeholder} />
    case 'dateRange':
      return <DatePicker.RangePicker {...rest} style={{ width: '100%' }} />
    case 'switch':
      return <Switch {...rest} />
    case 'rate':
      return <Rate {...rest} />
    case 'slider':
      return <Slider {...rest} min={field.min} max={field.max} />
    case 'memberSelect':
      return <MemberSelect {...rest} placeholder={field.placeholder} />
    case 'subTable':
      return <SubTableControl {...rest} field={field} />
    case 'upload':
      return (
        <Upload {...rest} beforeUpload={() => false} maxCount={5}>
          <Button icon={<UploadIcon size={14} />}>点击上传</Button>
        </Upload>
      )
    case 'input':
    default:
      return <Input {...rest} placeholder={field.placeholder} />
  }
}

function RadioGroupWithOptions({ field, ...rest }: { field: FieldNode } & InjectedProps) {
  const options = useFieldOptions(field)
  return <Radio.Group {...rest} options={options as { label: string; value: never }[]} />
}

function CheckboxGroupWithOptions({ field, ...rest }: { field: FieldNode } & InjectedProps) {
  const options = useFieldOptions(field)
  return <Checkbox.Group {...rest} options={options as { label: string; value: never }[]} />
}

/** 字段生效必填：固定必填 或 requiredWhen 联动命中 */
function isFieldRequired(field: FieldNode, values: Record<string, unknown>): boolean {
  if (field.required) return true
  return !!field.requiredWhen?.length && evalLinkRules(field.requiredWhen, values)
}

type FormRule = Rule

const NUMERIC_TYPES = ['number', 'money', 'percent']

/**
 * v2 字段 → antd rules。
 * 顺序：必填（required/requiredWhen）→ 格式（预置/自定义正则）→ 文本长度 → 数值范围。
 * 必填提示优先：其余校验对空值一律放行，由必填规则报「请填写」。
 * 数值 min/max：InputNumber 的 min/max 只是输入限制（失焦收敛），
 * 这里补 validator 做真正的提交前校验。
 */
function buildFieldRules(field: FieldNode, required: boolean): FormRule[] | undefined {
  const rules: FormRule[] = []
  // 计算字段值自动产生，不包必填规则
  if (required && !field.compute) rules.push({ required: true, message: `请填写${field.title}` })

  const v = field.validation
  if (v?.format) {
    const pattern =
      v.format === 'custom' ? compileCustomPattern(v.regex) : FORMAT_PATTERNS[v.format]
    if (pattern) {
      const message = v.message?.trim() || FORMAT_DEFAULT_MESSAGES[v.format]
      rules.push({
        validator: (_r, val) => {
          if (val === undefined || val === null || val === '') return Promise.resolve()
          // 先 trim 再匹配：首尾空白不应影响格式判断
          const s = typeof val === 'string' ? val.trim() : String(val)
          return pattern.test(s) ? Promise.resolve() : Promise.reject(new Error(message))
        },
      })
    }
  }
  if (v?.minLength != null || v?.maxLength != null) {
    rules.push({
      validator: (_r, val) => {
        if (val === undefined || val === null || val === '') return Promise.resolve()
        const s = String(val)
        // min 按 trim 后长度（纯空白不凑数）；max 按原始长度
        if (v.minLength != null && s.trim().length < v.minLength) {
          return Promise.reject(new Error(`至少输入 ${v.minLength} 个字符`))
        }
        if (v.maxLength != null && s.length > v.maxLength) {
          return Promise.reject(new Error(`最多输入 ${v.maxLength} 个字符`))
        }
        return Promise.resolve()
      },
    })
  }
  if (NUMERIC_TYPES.includes(field.type) && (field.min != null || field.max != null)) {
    rules.push({
      validator: (_r, val) => {
        if (val === undefined || val === null || val === '') return Promise.resolve()
        const n = Number(val)
        if (Number.isNaN(n)) return Promise.reject(new Error(`请输入数字`))
        if (field.min != null && n < field.min) {
          return Promise.reject(new Error(`${field.title}不能小于 ${field.min}`))
        }
        if (field.max != null && n > field.max) {
          return Promise.reject(new Error(`${field.title}不能大于 ${field.max}`))
        }
        return Promise.resolve()
      },
    })
  }
  return rules.length ? rules : undefined
}

/** v2 单个字段（edit 模式）：纯展示控件直接渲染，其余包 Form.Item；
 *  带 fieldPerms 时（审批人处理态）：hidden 不渲染，非 editable 渲染为只读回显（不进表单值编辑） */
function FieldCol({
  field,
  values,
  fieldPerms,
}: {
  field: FieldNode
  values: Record<string, unknown>
  fieldPerms?: Record<string, 'editable' | 'hidden'>
}) {
  const span = field.span * 6
  // visibleWhen 联动：条件不满足不渲染。Form.Item 默认 preserve=true，
  // 隐藏时不清值（重新显示时已填内容还在），这里刻意保留该行为
  if (field.visibleWhen?.length && !evalLinkRules(field.visibleWhen, values)) return null
  if (field.type === 'placeholder') {
    return (
      <Col key={field.id} span={span}>
        <div
          className="schema-form-placeholder"
          style={{ height: field.height ?? 80 }}
          aria-hidden
        />
      </Col>
    )
  }
  if (field.type === 'divider') {
    return (
      <Col key={field.id} span={span}>
        <Divider style={{ margin: '8px 0' }} />
      </Col>
    )
  }
  if (field.type === 'text') {
    return (
      <Col key={field.id} span={span}>
        <Alert type="info" showIcon message={field.tip || field.title} />
      </Col>
    )
  }
  if (field.type === 'title') {
    const level = (field.level ?? 2) as 1 | 2 | 3
    return (
      <Col key={field.id} span={span}>
        <Typography.Title level={level <= 3 ? level : 3} style={{ margin: '4px 0 12px' }}>
          {field.title}
        </Typography.Title>
      </Col>
    )
  }
  // 字段级审批权限（纯展示控件已在上面分支返回，不受影响）：
  // hidden 不渲染（值仍在 initialValues 里随提交保留）；只读字段用只读回显那套单字段渲染，不包 Form.Item
  if (fieldPerms) {
    const perm = fieldPerms[field.key]
    if (perm === 'hidden') return null
    if (perm !== 'editable') {
      return (
        <Col key={field.id} span={span}>
          {field.type === 'subTable' ? (
            <SubTableReadonly field={field} value={values[field.key]} />
          ) : (
            <div className="schema-form-ro-field">
              <div className="schema-form-ro-field-label">{field.title}</div>
              <div className="schema-form-ro-field-value">{formatValueV2(field, values[field.key])}</div>
            </div>
          )}
        </Col>
      )
    }
  }
  const required = isFieldRequired(field, values)
  // 明细子表：逐行校验必填子列，错误提示带行号定位；其余字段用标准 required 规则
  const rules =
    field.type === 'subTable'
      ? [
          {
            validator: (_rule: unknown, v: unknown) => {
              const rows: SubRow[] = Array.isArray(v) ? v : []
              if (required && !rows.length) return Promise.reject(new Error(`请添加至少一行${field.title}`))
              const reqCols = (field.subColumns ?? []).filter((c) => c.required)
              for (let i = 0; i < rows.length; i++) {
                for (const c of reqCols) {
                  const cv = rows[i]?.[c.key]
                  if (cv === undefined || cv === null || cv === '') {
                    return Promise.reject(new Error(`第 ${i + 1} 行「${c.title}」不能为空`))
                  }
                }
              }
              return Promise.resolve()
            },
          },
        ]
      : buildFieldRules(field, required)
  return (
    <Col key={field.id} span={span}>
      <Form.Item
        name={field.key}
        label={field.title}
        initialValue={field.defaultValue as string | undefined}
        rules={rules}
        extra={field.compute ? `自动计算：${field.compute}` : undefined}
        valuePropName={field.type === 'switch' ? 'checked' : field.type === 'upload' ? 'fileList' : undefined}
        getValueFromEvent={field.type === 'upload' ? normUploadFile : undefined}
      >
        <FieldControl field={field} />
      </Form.Item>
    </Col>
  )
}

/** v2 容器：group=标题分区 / block=虚线边框块 */
function SectionBox({
  section,
  values,
  fieldPerms,
}: {
  section: SectionNode
  values: Record<string, unknown>
  fieldPerms?: Record<string, 'editable' | 'hidden'>
}) {
  return (
    <Col span={24}>
      <div className={`schema-form-section is-${section.sectionType}`}>
        {section.title && <div className="schema-form-section-title">{section.title}</div>}
        <Row gutter={16}>
          {section.children.map((f) => (
            <FieldCol key={f.id} field={f} values={values} fieldPerms={fieldPerms} />
          ))}
        </Row>
      </div>
    </Col>
  )
}

/* ================= v2：readonly 回显 ================= */

function formatValueV2(field: FieldNode, value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  if (isDayjsLike(value)) return value.format('YYYY-MM-DD')
  if (field.type === 'upload' && Array.isArray(value)) {
    return value
      .map((f) => (typeof f === 'object' && f ? String((f as { name?: string }).name ?? f) : String(f)))
      .join('、')
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => (isDayjsLike(v) ? v.format('YYYY-MM-DD') : optionLabel(field, v)))
    return field.type === 'dateRange' ? parts.join(' ~ ') : parts.join('、')
  }
  if (field.type === 'switch') return value ? '是' : '否'
  if (field.type === 'rate') return `${value} 星`
  if (field.type === 'money') return `¥${Number(value).toLocaleString()}`
  if (field.type === 'percent') return `${value}%`
  return optionLabel(field, value)
}

/** select 系优先用静态选项把 value 翻译成 label（接口选项只读态不拉取，直接回显原值） */
function optionLabel(field: FieldNode, value: unknown): string {
  if (isSelectType(field.type) && field.options?.length) {
    const hit = field.options.find((o) => o.value === value)
    if (hit) return hit.label
  }
  return String(value)
}

const READONLY_SKIP = new Set(['placeholder', 'divider', 'text', 'title'])

/** 子表只读单元格格式化（date/money/percent/select 翻译，其余原值） */
function formatSubCell(col: SubColumn, v: unknown): string {
  if (v === undefined || v === null || v === '') return '-'
  if (isDayjsLike(v)) return v.format('YYYY-MM-DD')
  if (col.type === 'money') return `¥${Number(v).toLocaleString()}`
  if (col.type === 'percent') return `${v}%`
  if (col.type === 'select' && col.options?.length) {
    const hit = col.options.find((o) => o.value === v)
    if (hit) return hit.label
  }
  return String(v)
}

/** 明细子表（readonly 模式）：只读表格 */
function SubTableReadonly({ field, value }: { field: FieldNode; value: unknown }) {
  const rows: SubRow[] = Array.isArray(value) ? value : []
  const columns: ColumnsType<SubRow> = [
    { title: '序号', width: 52, render: (_v, _r, i) => i + 1 },
    ...(field.subColumns ?? []).map((c) => ({
      title: c.title,
      dataIndex: c.key,
      width: c.width,
      render: (v: unknown) => formatSubCell(c, v),
    })),
  ]
  return (
    <div className="schema-form-subtable-ro">
      <div className="schema-form-subtable-ro-label">{field.title}</div>
      <Table
        size="small"
        bordered
        pagination={false}
        rowKey={(_r, i) => String(i)}
        columns={columns}
        dataSource={rows}
      />
    </div>
  )
}

/** 直接按 v2 schema 渲染（edit / readonly） */
function SchemaCanvas({
  schema,
  mode,
  form,
  initialValues,
  fieldPerms,
  onFinish,
}: Required<Pick<SchemaFormProps, 'mode'>> & {
  schema: FormSchemaV2
} & Pick<SchemaFormProps, 'form' | 'initialValues' | 'fieldPerms' | 'onFinish'>) {
  // 联动需要监听全量表单值：外部没传 form 时用内部实例兜底（hooks 须在早退分支前无条件调用）
  const [ownForm] = Form.useForm()
  const formInst = form ?? ownForm
  const watched = Form.useWatch([], formInst) as Record<string, unknown> | undefined
  const values = useMemo(
    () => ({ ...(initialValues ?? {}), ...(watched ?? {}) }) as Record<string, unknown>,
    [initialValues, watched],
  )
  /** 配置了计算公式的顶层字段（数字系），用于 onValuesChange 自动重算 */
  const computeFields = useMemo(
    () => collectFields(schema.children).filter((f) => f.compute),
    [schema],
  )

  /**
   * 顶层计算字段自动重算：setFieldsValue 不会再触发 onValuesChange，无循环。
   * 做两轮遍历兜底：公式引用另一个计算字段时，第一轮可能读到对方的旧值，第二轮收敛。
   */
  const handleValuesChange = () => {
    if (!computeFields.length) return
    const formulas = Object.fromEntries(computeFields.map((f) => [f.key, f.compute!]))
    for (let round = 0; round < 2; round++) {
      const vals = formInst.getFieldsValue(true) as Record<string, unknown>
      computeFields.forEach((f) => {
        const val = evalFormula(f.compute!, vals, vals, formulas, new Set([f.key]))
        // money 字段结果保留两位小数，避免提交长尾值
        const v = f.type === 'money' && val !== null ? Math.round(val * 100) / 100 : val
        if (v !== (vals[f.key] ?? undefined)) formInst.setFieldsValue({ [f.key]: v ?? undefined })
      })
    }
  }

  if (mode === 'readonly') {
    const fields = schema.children
      .flatMap((n) => (n.kind === 'section' ? n.children : [n]))
      // visibleWhen 联动在只读回显同样生效：条件不满足的字段不展示
      .filter((f) => !f.visibleWhen?.length || evalLinkRules(f.visibleWhen, initialValues ?? {}))
    const descItems = fields
      .filter((f) => !READONLY_SKIP.has(f.type) && f.type !== 'subTable')
      .map((f) => ({
        key: f.id,
        label: f.title,
        children: formatValueV2(f, initialValues?.[f.key]),
      }))
    const tables = fields.filter((f) => f.type === 'subTable')
    return (
      <>
        {!!descItems.length && <Descriptions column={1} size="small" bordered items={descItems} />}
        {tables.map((f) => (
          <SubTableReadonly key={f.id} field={f} value={initialValues?.[f.key]} />
        ))}
      </>
    )
  }

  return (
    <Form form={formInst} layout="vertical" initialValues={initialValues} onFinish={onFinish} onValuesChange={handleValuesChange}>
      <Row gutter={16}>
        {schema.children.map((n) =>
          n.kind === 'section' ? (
            <SectionBox key={n.id} section={n} values={values} fieldPerms={fieldPerms} />
          ) : (
            <FieldCol key={n.id} field={n} values={values} fieldPerms={fieldPerms} />
          ),
        )}
      </Row>
    </Form>
  )
}

/* ================= 旧版 Formily 风格 fallback ================= */

function renderComponent(p: SchemaProperty) {
  const props = (p['x-component-props'] ?? {}) as Props
  const placeholder = props.placeholder as string | undefined
  switch (p['x-component']) {
    case 'TextArea':
      return <Input.TextArea placeholder={placeholder} rows={(props.rows as number) ?? 3} />
    case 'InputNumber':
      return <InputNumber style={{ width: '100%' }} placeholder={placeholder} />
    case 'Money':
      return (
        <InputNumber
          style={{ width: '100%' }}
          placeholder={placeholder}
          prefix="¥"
          min={0}
          precision={2}
        />
      )
    case 'Percent':
      return (
        <InputNumber
          style={{ width: '100%' }}
          placeholder={placeholder}
          addonAfter="%"
          min={0}
          max={100}
        />
      )
    case 'Select':
      return (
        <Select
          placeholder={placeholder}
          options={(props.options ?? p.enum ?? []) as { label: string; value: string }[]}
          allowClear
        />
      )
    case 'SelectSearch':
      return (
        <Select
          placeholder={placeholder}
          options={(props.options ?? p.enum ?? []) as { label: string; value: string }[]}
          showSearch
          optionFilterProp="label"
          allowClear
        />
      )
    case 'DatePicker':
      return <DatePicker style={{ width: '100%' }} placeholder={placeholder} />
    case 'DateRange':
      return <DatePicker.RangePicker style={{ width: '100%' }} />
    case 'MemberSelect':
      return (
        <Select
          mode="multiple"
          placeholder={placeholder}
          options={MEMBERS.map((m) => ({ label: m, value: m }))}
          allowClear
        />
      )
    case 'Input':
    default:
      return <Input placeholder={placeholder} />
  }
}

function isDayjsLike(v: unknown): v is dayjs.Dayjs {
  return !!v && typeof v === 'object' && typeof (v as dayjs.Dayjs).format === 'function'
}

function formatValue(p: SchemaProperty, value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  if (isDayjsLike(value)) return value.format('YYYY-MM-DD')
  if (Array.isArray(value)) {
    const parts = value.map((v) => (isDayjsLike(v) ? v.format('YYYY-MM-DD') : String(v)))
    return p['x-component'] === 'DateRange' ? parts.join(' ~ ') : parts.join('、')
  }
  if (p['x-component'] === 'Money') return `¥${Number(value).toLocaleString()}`
  if (p['x-component'] === 'Percent') return `${value}%`
  return String(value)
}

/** 旧版 schema 渲染（edit / readonly），布局取 x-col-span */
function LegacySchemaFields({
  schema,
  mode,
  form,
  initialValues,
  fieldPerms,
  onFinish,
}: { schema: FormSchema } & Required<Pick<SchemaFormProps, 'mode'>> &
  Pick<SchemaFormProps, 'form' | 'initialValues' | 'fieldPerms' | 'onFinish'>) {
  const entries = Object.entries(schema.properties ?? {}).filter(
    ([, p]) => mode === 'edit' || p['x-component'] !== 'Placeholder',
  )

  if (mode === 'readonly') {
    return (
      <Descriptions
        column={1}
        size="small"
        bordered
        items={entries.map(([key, p]) => ({
          key,
          label: p.title,
          children: formatValue(p, initialValues?.[key]),
        }))}
      />
    )
  }

  return (
    <Form form={form} layout="vertical" initialValues={initialValues} onFinish={onFinish}>
      <Row gutter={16}>
        {entries.map(([key, p]) => {
          const span = p['x-col-span'] ?? 24
          // 空白占位符：输出空 Col 占位，不占表单值
          if (p['x-component'] === 'Placeholder') {
            return (
              <Col key={key} span={span}>
                <div className="schema-form-placeholder" aria-hidden />
              </Col>
            )
          }
          const props = (p['x-component-props'] ?? {}) as Props
          // 字段级审批权限（旧版 schema）：hidden 不渲染（值随 initialValues 保留）；非 editable 只读回显
          if (mode === 'edit' && fieldPerms) {
            const perm = fieldPerms[key]
            if (perm === 'hidden') return null
            if (perm !== 'editable') {
              return (
                <Col key={key} span={span}>
                  <div className="schema-form-ro-field">
                    <div className="schema-form-ro-field-label">{p.title}</div>
                    <div className="schema-form-ro-field-value">
                      {formatValue(p, initialValues?.[key])}
                    </div>
                  </div>
                </Col>
              )
            }
          }
          return (
            <Col key={key} span={span}>
              <Form.Item
                name={key}
                label={p.title}
                initialValue={props.defaultValue as string | undefined}
                rules={p.required ? [{ required: true, message: `请填写${p.title}` }] : undefined}
              >
                {renderComponent(p)}
              </Form.Item>
            </Col>
          )
        })}
      </Row>
    </Form>
  )
}

/* ================= 入口 ================= */

export default function SchemaForm(props: SchemaFormProps) {
  const { schema: schemaProp, formCode, mode, form, initialValues, fieldPerms, onFinish, onSubmit } = props
  const [fetched, setFetched] = useState<FormSchema | FormSchemaV2 | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // formCode 链路：按 code 拉取启用表单的 schema
  useEffect(() => {
    if (schemaProp || !formCode) return
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    fetchFormByCode(formCode)
      .then((def) => {
        if (cancelled) return
        if (def?.schema) setFetched(def.schema)
        else setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [schemaProp, formCode])

  const schema = schemaProp ?? fetched
  const handleFinish = (values: Record<string, unknown>) => {
    onFinish?.(values)
    onSubmit?.(values)
  }

  if (schema) {
    // 分支一：version 2 画布结构
    if (isV2Schema(schema)) {
      return (
        <SchemaCanvas
          schema={schema}
          mode={mode}
          form={form}
          initialValues={initialValues}
          fieldPerms={fieldPerms}
          onFinish={handleFinish}
        />
      )
    }
    // 分支二：旧版 Formily 风格 fallback（存量表单）
    return (
      <LegacySchemaFields
        schema={schema}
        mode={mode}
        form={form}
        initialValues={initialValues}
        fieldPerms={fieldPerms}
        onFinish={handleFinish}
      />
    )
  }
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Spin size="small" />
      </div>
    )
  }
  return (
    <Empty
      description={notFound ? `未找到启用的表单：${formCode}` : '表单暂无 schema'}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  )
}
