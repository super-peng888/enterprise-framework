/**
 * 低代码表单 schema 模型（version 2）。
 *
 * 存储：form_definition.schema（jsonb 自由格式），后端无需改动。
 * 结构：FormSchemaV2.children 为画布顶层节点（容器 SectionNode 或字段 FieldNode）；
 * 画布与容器内部均为 4 列栅格，字段 span 1-4 表示占几列（渲染端 ×6 映射 antd 24 栅格）。
 *
 * 兼容：旧版 Formily 风格 schema（{type:'object',properties:{...}}）由
 * SchemaForm 走 fallback 分支渲染；设计器载入旧 schema 时用 legacyToCanvas 转换。
 */
import type { FormSchema as LegacyFormSchema } from '@/mocks/approval'

/* ---------------- 类型定义 ---------------- */

export type FieldType =
  | 'input'
  | 'textarea'
  | 'number'
  | 'money'
  | 'percent'
  | 'select'
  | 'selectSearch'
  | 'multiSelect'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'dateRange'
  | 'switch'
  | 'rate'
  | 'slider'
  | 'memberSelect'
  | 'upload'
  | 'subTable'
  | 'placeholder'
  | 'divider'
  | 'text'
  | 'title'

export interface FieldOption {
  label: string
  value: unknown
}

/** select 系控件的数据源：静态选项 或 接口获取 */
export interface FieldDataSource {
  mode: 'static' | 'api'
  /** GET 接口地址（相对 /api 或绝对） */
  url?: string
  /** 从返回 JSON 取数组的路径，如 data.list（支持 a.b.c 点路径） */
  resultPath?: string
  /** 数组元素里哪个字段做 label */
  labelField?: string
  /** 哪个字段做 value */
  valueField?: string
}

/** 明细子表的子列（受限 6 种类型，选项仅 select 用） */
export interface SubColumn {
  key: string
  title: string
  type: 'input' | 'number' | 'money' | 'percent' | 'select' | 'date'
  width?: number
  required?: boolean
  options?: FieldOption[]
  /** 行内计算公式（仅 number/money/percent 列有意义）：可引用同行其他列，如 quantity * price */
  compute?: string
}

/** 字段联动规则：与审批条件分支 Condition 同型（{field, op, value}），多规则为「且」关系 */
export interface LinkRule {
  field: string
  op: string
  value: string
}

/* ---------------- 字段校验 ---------------- */

export type ValidationFormat = 'phone' | 'email' | 'idcard' | 'url' | 'custom'

/** 字段校验配置（存储在 FieldNode.validation） */
export interface FieldValidation {
  /** 预置格式；custom 表示用 regex 自定义正则 */
  format?: ValidationFormat
  /** format='custom' 时的自定义正则（字符串，渲染端 new RegExp 编译） */
  regex?: string
  /** 格式校验失败的自定义错误文案，缺省用 FORMAT_DEFAULT_MESSAGES */
  message?: string
  /** 文本类字段（input/textarea）长度限制 */
  minLength?: number
  maxLength?: number
}

/** 预置格式正则：手机号 / 邮箱 / 身份证 18 位 / URL */
export const FORMAT_PATTERNS: Record<Exclude<ValidationFormat, 'custom'>, RegExp> = {
  phone: /^1[3-9]\d{9}$/,
  email: /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/,
  idcard: /^\d{17}[\dXx]$/,
  url: /^https?:\/\/[\w.-]+(:\d+)?(\/\S*)?$/,
}

/** 各格式缺省错误文案 */
export const FORMAT_DEFAULT_MESSAGES: Record<ValidationFormat, string> = {
  phone: '请输入正确的手机号',
  email: '请输入正确的邮箱',
  idcard: '请输入正确的身份证号',
  url: '请输入正确的链接（http/https）',
  custom: '格式不正确',
}

/** custom 正则编译；非法正则返回 null（渲染端忽略，不阻断表单） */
export function compileCustomPattern(regex?: string): RegExp | null {
  if (!regex?.trim()) return null
  try {
    return new RegExp(regex)
  } catch {
    return null
  }
}

export interface FieldNode {
  id: string
  kind: 'field'
  type: FieldType
  /** 表单内唯一，小写下划线 */
  key: string
  title: string
  /** 4 列栅格占几列 */
  span: 1 | 2 | 3 | 4
  placeholder?: string
  required?: boolean
  defaultValue?: unknown
  /** 静态选项（select 系） */
  options?: FieldOption[]
  dataSource?: FieldDataSource
  /** 占位符高度 px（40-400） */
  height?: number
  /** 提示控件的文本 */
  tip?: string
  /** 数字/金额/百分比：最小/最大值 */
  min?: number
  max?: number
  /** textarea 行数 */
  rows?: number
  /** 标题级别（1-3） */
  level?: number
  /** 明细子表：子列定义，值为行对象数组（按子列 key） */
  subColumns?: SubColumn[]
  /** 显示条件：全部命中才显示；空/未配置 = 恒显示 */
  visibleWhen?: LinkRule[]
  /** 必填条件：全部命中时必填；空/未配置 = 不联动必填 */
  requiredWhen?: LinkRule[]
  /** 校验配置（格式 / 长度），见 FieldValidation */
  validation?: FieldValidation
  /** 计算公式（仅 number/money/percent 有意义）：值由公式自动算出、只读不可手填，如 price * count、SUM(detail.amount) */
  compute?: string
}

/** 容器：group 分组（带标题的分区）/ block 块（虚线边框区块，可复制/移除） */
export interface SectionNode {
  id: string
  kind: 'section'
  sectionType: 'group' | 'block'
  title: string
  children: FieldNode[]
}

export type CanvasNode = SectionNode | FieldNode

export interface FormSchemaV2 {
  version: 2
  children: CanvasNode[]
}

/** 设计器保存的 schema：新画布 v2，旧表单载入后保存即升级为 v2 */
export type DesignerSchema = FormSchemaV2

/* ---------------- 类型判断 ---------------- */

export function isV2Schema(schema: unknown): schema is FormSchemaV2 {
  return (
    !!schema &&
    typeof schema === 'object' &&
    (schema as FormSchemaV2).version === 2 &&
    Array.isArray((schema as FormSchemaV2).children)
  )
}

/** select 系控件（共用数据源配置：静态选项 / 接口获取） */
export const SELECT_TYPES: FieldType[] = ['select', 'selectSearch', 'multiSelect', 'radio', 'checkbox']
export const isSelectType = (t: FieldType) => SELECT_TYPES.includes(t)

/** 纯展示控件：无表单值、不参与 key 唯一性录入（key 自动生成） */
export const DISPLAY_TYPES: FieldType[] = ['divider', 'text', 'title']
export const isDisplayType = (t: FieldType) => DISPLAY_TYPES.includes(t)

/* ---------------- 控件元数据 ---------------- */

export const FIELD_META: Record<FieldType, { label: string; defaultTitle: string }> = {
  input: { label: '单行文本', defaultTitle: '单行文本' },
  textarea: { label: '多行文本', defaultTitle: '多行文本' },
  number: { label: '数字', defaultTitle: '数字' },
  money: { label: '金额', defaultTitle: '金额' },
  percent: { label: '百分比', defaultTitle: '百分比' },
  select: { label: '下拉选择', defaultTitle: '下拉选择' },
  selectSearch: { label: '下拉选择(带搜索)', defaultTitle: '下拉选择' },
  multiSelect: { label: '下拉多选', defaultTitle: '下拉多选' },
  radio: { label: '单选按钮', defaultTitle: '单选按钮' },
  checkbox: { label: '复选框', defaultTitle: '复选框' },
  date: { label: '日期', defaultTitle: '日期' },
  dateRange: { label: '日期范围', defaultTitle: '日期范围' },
  switch: { label: '开关', defaultTitle: '开关' },
  rate: { label: '评分', defaultTitle: '评分' },
  slider: { label: '滑杆', defaultTitle: '滑杆' },
  memberSelect: { label: '成员选择', defaultTitle: '成员选择' },
  upload: { label: '附件上传', defaultTitle: '附件上传' },
  subTable: { label: '明细子表', defaultTitle: '明细子表' },
  placeholder: { label: '占位符', defaultTitle: '' },
  divider: { label: '分割线', defaultTitle: '' },
  text: { label: '提示文本', defaultTitle: '提示' },
  title: { label: '标题', defaultTitle: '标题' },
}

/* ---------------- 节点工厂 ---------------- */

let nodeSeq = 0

function nextId(prefix: string): string {
  nodeSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${nodeSeq}`
}

export function createFieldNode(type: FieldType): FieldNode {
  const meta = FIELD_META[type]
  const node: FieldNode = {
    id: nextId('f'),
    kind: 'field',
    type,
    key: nextId('field'),
    title: meta.defaultTitle,
    span: isDisplayType(type) ? 4 : 1,
    required: false,
  }
  if (type === 'placeholder') node.height = 80
  if (type === 'text') node.tip = '提示文本内容'
  if (type === 'title') node.level = 2
  if (type === 'textarea') node.rows = 3
  if (type === 'money') node.min = 0
  if (type === 'subTable') {
    // 子表默认整行（4 列），自带两列示例子列
    node.span = 4
    node.subColumns = [
      { key: 'item', title: '明细', type: 'input', required: true },
      { key: 'amount', title: '金额', type: 'money' },
    ]
  }
  if (type === 'percent') {
    node.min = 0
    node.max = 100
  }
  if (isSelectType(type)) {
    node.dataSource = { mode: 'static' }
    node.options = [
      { label: '选项一', value: '选项一' },
      { label: '选项二', value: '选项二' },
    ]
  }
  return node
}

export function createSectionNode(sectionType: 'group' | 'block'): SectionNode {
  return {
    id: nextId('s'),
    kind: 'section',
    sectionType,
    title: sectionType === 'group' ? '分组' : '块',
    children: [],
  }
}

/** 深拷贝节点并重新分配 id（块复制用；key 加 _copy 后缀避免冲突） */
export function cloneSectionNode(section: SectionNode): SectionNode {
  return {
    ...section,
    id: nextId('s'),
    title: `${section.title} 副本`,
    children: section.children.map((f) => ({ ...f, id: nextId('f'), key: `${f.key}_copy` })),
  }
}

/* ---------------- 树操作 ---------------- */

/** 递归收集所有字段节点 */
export function collectFields(children: CanvasNode[]): FieldNode[] {
  const out: FieldNode[] = []
  children.forEach((n) => {
    if (n.kind === 'field') out.push(n)
    else out.push(...n.children)
  })
  return out
}

/** 按 id 查找节点（字段或容器） */
export function findNode(children: CanvasNode[], id: string): CanvasNode | null {
  for (const n of children) {
    if (n.id === id) return n
    if (n.kind === 'section') {
      const hit = n.children.find((f) => f.id === id)
      if (hit) return hit
    }
  }
  return null
}

/** 从树中摘除节点，返回 [新树, 被摘除的节点] */
export function detachNode(children: CanvasNode[], id: string): [CanvasNode[], CanvasNode | null] {
  let removed: CanvasNode | null = null
  const next: CanvasNode[] = []
  for (const n of children) {
    if (n.id === id) {
      removed = n
      continue
    }
    if (n.kind === 'section') {
      const idx = n.children.findIndex((f) => f.id === id)
      if (idx >= 0) {
        removed = n.children[idx]
        next.push({ ...n, children: n.children.filter((f) => f.id !== id) })
        continue
      }
    }
    next.push(n)
  }
  return [next, removed]
}

/**
 * 在目标位置插入节点。
 * containerId 为 null 表示画布顶层；index 为该层数组下标。
 */
export function insertNode(
  children: CanvasNode[],
  node: CanvasNode,
  containerId: string | null,
  index: number,
): CanvasNode[] {
  if (node.kind === 'section' && containerId) return children // 容器不可嵌套容器
  if (!containerId) {
    const next = [...children]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node)
    return next
  }
  return children.map((n) => {
    if (n.id !== containerId || n.kind !== 'section') return n
    const list = [...n.children]
    list.splice(Math.max(0, Math.min(index, list.length)), 0, node as FieldNode)
    return { ...n, children: list }
  })
}

/** 更新字段节点 */
export function patchFieldNode(
  children: CanvasNode[],
  id: string,
  patch: Partial<FieldNode>,
): CanvasNode[] {
  return children.map((n) => {
    if (n.kind === 'field') return n.id === id ? { ...n, ...patch } : n
    return {
      ...n,
      children: n.children.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }
  })
}

/** 更新容器节点 */
export function patchSectionNode(
  children: CanvasNode[],
  id: string,
  patch: Partial<SectionNode>,
): CanvasNode[] {
  return children.map((n) => (n.id === id && n.kind === 'section' ? { ...n, ...patch } : n))
}

/* ---------------- 校验 ---------------- */

/** 字段 key：小写字母开头，仅限小写字母 / 数字 / 下划线 */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/** 返回错误文案，null 表示合法。纯展示控件不校验 key。 */
export function fieldKeyError(field: FieldNode, all: FieldNode[]): string | null {
  if (isDisplayType(field.type)) return null
  if (!field.key.trim()) return '编码不能为空'
  if (!KEY_PATTERN.test(field.key)) return '小写字母开头，仅限小写字母 / 数字 / 下划线'
  if (all.some((o) => o.id !== field.id && !isDisplayType(o.type) && o.key === field.key)) {
    return '同一表单内编码必须唯一'
  }
  return null
}

/** select 接口数据源必填项校验 */
export function dataSourceError(field: FieldNode): string | null {
  if (!isSelectType(field.type) || field.dataSource?.mode !== 'api') return null
  const ds = field.dataSource
  if (!ds.url?.trim()) return '请填写接口地址'
  if (!ds.resultPath?.trim()) return '请填写结果取值路径'
  if (!ds.labelField?.trim()) return '请填写 label 字段'
  if (!ds.valueField?.trim()) return '请填写 value 字段'
  return null
}

/* ---------------- 字段联动求值 ---------------- */

/** 联动操作符（与审批条件分支 CONDITION_OPS 同集） */
export const LINK_OPS = ['<', '≤', '>', '≥', '=', '≠']

/** 尝试解析为数值；空串 / null / 非数值返回 null */
function toComparableNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/** 单条规则求值：两边都能解析为数字按数值比较，否则按字符串；<≤>≥ 遇到非数值恒 false */
export function evalLinkRule(rule: LinkRule, values: Record<string, unknown>): boolean {
  const actual = values[rule.field]
  const an = toComparableNumber(actual)
  const en = toComparableNumber(rule.value)
  if (rule.op === '=' || rule.op === '≠') {
    const eq = an !== null && en !== null ? an === en : String(actual ?? '') === rule.value
    return rule.op === '=' ? eq : !eq
  }
  if (an === null || en === null) return false
  switch (rule.op) {
    case '<':
      return an < en
    case '≤':
      return an <= en
    case '>':
      return an > en
    case '≥':
      return an >= en
    default:
      return false
  }
}

/** 多条规则为「且」关系；空规则视为命中（不配置 = 不限制） */
export function evalLinkRules(rules: LinkRule[] | undefined, values: Record<string, unknown>): boolean {
  if (!rules?.length) return true
  return rules.every((r) => evalLinkRule(r, values))
}

/* ---------------- 旧 schema 兼容 ---------------- */

const LEGACY_COMPONENT_TO_TYPE: Record<string, FieldType> = {
  Input: 'input',
  TextArea: 'textarea',
  InputNumber: 'number',
  Money: 'money',
  Percent: 'percent',
  Select: 'select',
  SelectSearch: 'selectSearch',
  DatePicker: 'date',
  DateRange: 'dateRange',
  MemberSelect: 'memberSelect',
  Placeholder: 'placeholder',
}

/** 旧 24 栅格 → 新 4 列栅格（8/24、6/24 归并到 1 列） */
function legacySpan(xColSpan?: number): 1 | 2 | 3 | 4 {
  if (xColSpan === 12) return 2
  if (xColSpan === 8 || xColSpan === 6) return 1
  return 4
}

/** 旧版 Formily 风格 schema → v2 画布节点（设计器载入存量表单用） */
export function legacyToCanvas(schema: LegacyFormSchema): CanvasNode[] {
  return Object.entries(schema.properties ?? {}).map(([key, p], i) => {
    const type = LEGACY_COMPONENT_TO_TYPE[p['x-component']] ?? 'input'
    const props = p['x-component-props'] ?? {}
    // 旧 schema 选项有两种放法：x-component-props.options 或属性级 enum
    const rawOptions = (props.options ?? p.enum) as { label: string; value: unknown }[] | undefined
    const node: FieldNode = {
      id: `f_load_${i}_${key}`,
      kind: 'field',
      type,
      key,
      title: p.title ?? key,
      span: legacySpan(p['x-col-span']),
      placeholder: props.placeholder as string | undefined,
      required: !!p.required,
      defaultValue: props.defaultValue,
    }
    if (isSelectType(type)) {
      node.dataSource = { mode: 'static' }
      node.options = rawOptions ?? []
    }
    if (type === 'placeholder') node.height = 80
    if (type === 'textarea') node.rows = (props.rows as number) ?? 3
    return node
  })
}

/** 载入任意形态的 schema → v2 画布（旧 schema 自动转换） */
export function toCanvasChildren(schema: unknown): CanvasNode[] {
  if (isV2Schema(schema)) return schema.children
  if (schema && typeof schema === 'object' && (schema as LegacyFormSchema).type === 'object') {
    return legacyToCanvas(schema as LegacyFormSchema)
  }
  return []
}

/* ---------------- 点路径解析（接口数据源取数） ---------------- */

/** 按 a.b.c 点路径从 JSON 取值；任一层缺失返回 undefined */
export function getByPath(obj: unknown, path?: string): unknown {
  if (!path?.trim()) return undefined
  let cur: unknown = obj
  for (const seg of path.trim().split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * 接口数据源地址规范化：
 * - 完整 http(s):// 地址 → 原样使用
 * - 裸 host:port（如 localhost:8080/system/users）→ 自动补 http://
 * - 其余相对路径（/system/users、system/users）→ 交给 request 走网关（baseURL '/api'）
 */
export function resolveApiUrl(url: string): string {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (/^[\w.-]+:\d+/.test(u)) return `http://${u}`
  return u
}
