# 03 通用组件：DataTable / FormModal / SchemaForm

> 面向接手维护者。三个组件均在 `frontend/src/components/` 下，全部只依赖 antd 一手 API，
> 用于替代 `@ant-design/pro-components`（Table / ModalForm / ProForm）与 Formily。
> 本文所有行为描述均对照源码核实，行内括注为关键实现位置。

---

## 1. DataTable —— schema 驱动的表格

源码：`frontend/src/components/DataTable/DataTable.tsx`（逻辑）、`DataTable.css`（样式）。

能力总览（组件头注释原话）：服务端分页、可折叠搜索区、工具栏（刷新/列设置/全屏）、
列头拖拽换序、列头筛选（select/text）、列设置面板（显隐+排序+重置）、
localStorage 持久化（`dt:${storageKey}`）、行右键菜单、ResizeObserver 自动撑高。

整体 DOM 结构：

```
dt-root（卡片容器，全屏时 :fullscreen 铺满）
 ├─ dt-search        悬浮搜索条（独立于表格卡片，浮在上方；可折叠）
 └─ dt-card          表格区
     ├─ dt-toolbar   工具栏：左 = title + toolbarActions，右 = 刷新 / 列设置 / 全屏
     └─ dt-table-wrap  antd Table（ResizeObserver 计算 scroll.y 自动撑高）
```

### 1.1 Props 速查表

`DataTableProps<T>`（DataTable.tsx:75-99）：

| Prop | 类型 | 必填 | 说明 |
|---|---|---|---|
| `columns` | `DataTableColumn<T>[]` | 是 | 列定义，见 1.2 |
| `fetchData` | `(params) => Promise<{ list: T[]; total: number }>` | 是 | 取数函数，见下 |
| `rowKey` | `string` | 是 | 行主键字段名 |
| `storageKey` | `string` | 是 | 列设置持久化 key，实际存储键为 `dt:${storageKey}`，必传避免冲突 |
| `searchFields` | `SearchField[]` | 否 | 搜索区字段；不传或空数组则整个搜索条不渲染 |
| `title` | `ReactNode` | 否 | 工具栏左侧标题 |
| `toolbarActions` | `ReactNode` | 否 | 工具栏左侧按钮（新建/导出等），跟在 title 后 |
| `contextMenuItems` | `(record: T) => ContextMenuItem[]` | 否 | 行右键菜单；返回空数组则该行无菜单 |
| `onRowClick` | `(record: T) => void` | 否 | 行点击；传了会给行加 `dt-row-clickable`（pointer 光标） |
| `pageSize` | `number` | 否 | 默认 10 |
| `pagination` | `false` | 否 | 传 `false` 关闭分页（如树形菜单表） |
| `expandAllRows` | `boolean` | 否 | 树形数据默认展开所有含子级的行（受控实现，用户仍可手动折叠） |
| `flat` | `boolean` | 否 | 嵌在卡片内时使用，去掉自身玻璃底（加 `dt-flat` class） |

`fetchData` 入参（DataTable.tsx:77-82）：

```ts
{
  page: number                      // 当前页，1 起
  size: number                      // 每页条数
  search: Record<string, any>       // 搜索区「查询」按钮应用后的值
  filters: Record<string, any[]>    // 列头筛选（select 为多选数组；text 包装成单元素数组）
}
```

注意两个语义点：

- **搜索值分「输入中」和「已应用」两份状态**（`searchValues` / `appliedSearch`）：
  输入过程不触发请求，点「查询」或回车才把 `searchValues` 拷贝进 `appliedSearch`
  并回到第 1 页（`handleSearch`，DataTable.tsx:237-240）。
- **列头筛选是即时的**：勾选/输入即请求并回到第 1 页；text 筛选非空时包装为
  `[value]` 合并进 `filters`（`mergedFilters`，DataTable.tsx:185-191）。

`SearchField`（DataTable.tsx:54-60）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 提交到 `search` 的键 |
| `label` | `string` | 标签（固定 64px 宽右对齐） |
| `type` | `'input' \| 'select'` | 控件类型 |
| `options` | `{ label; value }[]` | select 的选项 |
| `placeholder` | `string` | 缺省 `请输入${label}` / `请选择${label}` |

`ContextMenuItem`（DataTable.tsx:62-68）：`{ key, label, icon?, danger?, onClick }`，
直接映射 antd `Dropdown` 的 menu items。

### 1.2 ref 句柄

`DataTableRef`（DataTable.tsx:70-73），`useImperativeHandle` 暴露（:250）：

| 方法 | 说明 |
|---|---|
| `reload()` | 按当前查询条件重新请求 |
| `resetSearch()` | 清空搜索值、已应用搜索、全部列头筛选，回到第 1 页并重新请求 |

组件用 `forwardRef` 包装并重签名泛型（DataTable.tsx:788-790），用法：
`const tableRef = useRef<DataTableRef>(null)` → `<DataTable ref={tableRef} ... />`。

### 1.3 DataTableColumn 全字段

`DataTableColumn<T>`（DataTable.tsx:32-52）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 列键，同时作为 `dataIndex`；也是排序/筛选/持久化的标识 |
| `title` | `string` | 列标题 |
| `width` | `number` | 列宽；未设时按 140 参与 `scroll.x` 汇总与调宽起点 |
| `align` | `'left' \| 'center' \| 'right'` | 对齐 |
| `fixed` | `'left' \| 'right'` | 固定列 |
| `sort` | `true \| 'asc' \| 'desc' \| ((a, b) => number)` | 排序配置，见 1.4.1；不传则不可排序 |
| `resizable` | `boolean` | 是否允许拖拽调宽，默认 `true`（仅 `=== false` 关闭） |
| `filterType` | `'select' \| 'text'` | 列头筛选类型；不传则无筛选图标 |
| `filterOptions` | `{ label; value }[]` | select 筛选的可选项；缺省时从**当前页数据**去重生成 |
| `render` | `(record, index) => ReactNode` | 单元格渲染（注意签名是 record 在前，与 antd 不同） |
| `defaultHidden` | `boolean` | 初始隐藏（用户可在列设置面板重新打开） |

### 1.4 能力逐一说明

#### 1.4.1 自研排序（为什么不用 antd sorter）

列配置 `sort`（DataTable.tsx:38-43）：

- `true`：允许点击表头循环排序，用内置比较器（数字做减法，其余按 `zh-CN`
  `localeCompare`，`defaultCompare`，:133-140）；
- `'asc'` / `'desc'`：作为**初始排序**方向，仍可点击循环（列配置变化时经
  `sortSig` 签名重新应用，:175-180）；
- 函数：自定义比较器。

表头文字点击走 `cycleSort`（:205-211）**三态循环：默认（无图标）→ 升序 → 降序 → 默认**。
升序图标 `ArrowUpNarrowWide`、降序 `ArrowDownWideNarrow`（lucide），默认态不显示任何图标。

不用 antd `sorter` 的原因：antd 的 sorter 与受控列定义、自研表头（拖拽手柄 + 筛选图标 +
调宽手柄的组合）叠加时事件与渲染都会打架，且 antd 排序图标常亮、视觉噪音大。自研排序
状态只有 `{ key, order } | null`，排序在 `sortedData`（:194-202）里对**当前页数据**做
内存排序——服务端分页下排序只作用于当前页，这是有意取舍，接入方如需全量排序应在
`fetchData` 内自行处理。

#### 1.4.2 列宽拖拽（自定义光标 + 持久化）

每列表头右侧有 6px 宽的 `.dt-col-resizer` 手柄（`title="拖拽调整列宽"`）。按下后
`onResizeStart`（:319-337）在 window 上挂 `mousemove/mouseup`，实时把新宽度写进
`colDefs`（最小 60px），随 `colDefs` 一起持久化到 `dt:${storageKey}`。

光标不是系统 `col-resize`，而是 `DataTable.css:315-317` 里内联的 SVG data-URI
（lucide `chevrons-left-right` 图标，热点 `12 12`），与全局 lucide 图标风格统一。
手柄同时拦截了 `click` 与 `dragStart`，避免误触排序和列拖拽。

#### 1.4.3 列序拖拽（专用手柄；th 为什么不设 draggable）

表头左侧有 `.dt-drag-handle`（`GripVertical` 图标，hover 才显现，`title="拖拽调整列顺序"`），
只有它是 `draggable` 的；`th` 上只挂 `onDragOver/onDrop/onDragEnd` 做放置目标。

**为什么 th 不设 draggable**（`onHeaderCell` 注释，:527-529）：Chrome 下给 `th` 设
`draggable` 会吞掉 click 事件，导致排序点不动。拖拽因此改由标题里的专用手柄发起，
`onDragStart` 里 `stopPropagation` 防止冒泡。

落点逻辑 `moveColumn`（:339-350）：把拖拽列从数组中摘除后插入目标列位置；
拖动中经 `is-dragging` / `is-drag-over` class 给出视觉反馈。列设置面板里的列表项
同样可拖拽排序，与表头拖拽共用同一套 `dragKey/dragOverKey` 状态。

#### 1.4.4 列头筛选（select / text）

列配了 `filterType` 后表头出现 `Filter` 图标（有激活值时 `is-active` 高亮），点击弹
`Popover`：

- `select`：checkbox 列表 + 底部「重置」链接；`filterOptions` 缺省时用
  `distinctValues`（:379-383）从当前页数据去重生成，空列表显示「暂无可选值」。
- `text`：一个 `allowClear` 输入框，占位 `搜索${col.title}`。

两者都是即时生效（写入状态 + 回到第 1 页）。筛选值经 `mergedFilters` 合并后作为
`fetchData` 的 `filters` 参数：**过滤动作由接入方（前端内存或后端）完成，组件本身
不过滤数据**。

#### 1.4.5 列设置面板（显隐 + 拖拽 + 重置）

工具栏右侧 `Settings2` 图标弹 `Popover`：每行 = 拖拽手柄 + checkbox（显隐）+ 列名，
底部提示「拖动调整列顺序，勾选控制显隐」；标题栏右侧有「重置」链接
（`resetColumns`，:303-310：恢复 `defaultHidden` 初始态并删除 localStorage 记录）。

持久化细节（`loadColDefs`，:112-131）：按保存数组的顺序合并，已删除的列自动剔除、
新增列追加到尾部（保持 `defaultHidden`）；只持久化 `{ key, visible, width }` 三个字段。
`columns` 配置变化按 `key:title` 签名检测（`columnsSig`，:286-290）后重新合并。

#### 1.4.6 悬浮搜索条（折叠 / 按钮钉右上）

搜索条独立于表格卡片（`.dt-search`，浅色浅灰内嵌 / dark 磨砂玻璃），字段区
`flex-wrap` 排布。默认折叠（`searchCollapsed = true`），折叠态 CSS 只保留一行高度
（`.is-collapsed { max-height: 32px }`），「展开/收起」链接切换，chevron 图标随方向旋转。

「查询 / 重置 / 展开收起」按钮组 `.dt-search-actions` 是 `flex: none` 钉在搜索条右上角，
折叠/展开都不动（DataTable.css:104-105 注释原话）。「重置」在无搜索条件且
无列头筛选时禁用（`hasSearchCondition`，:277-280）。

#### 1.4.7 工具栏右侧（刷新 / 列设置 / 全屏）

三个 `.dt-tool-btn` 图标按钮：`RefreshCw` 刷新（调 `reload`）、`Settings2` 列设置、
`Maximize/Minimize` 全屏。全屏用原生 Fullscreen API 作用于 `dt-root`，监听
`fullscreenchange` 同步图标；`:fullscreen` 下容器换页面底色并 `overflow: auto`
（DataTable.css:23-25）。

#### 1.4.8 行右键菜单

传了 `contextMenuItems` 才启用：经 `components.body.row` 自定义行渲染，用
`Dropdown trigger={['contextMenu']}` 包裹 `<tr>`（`bodyRow`，:560-578）。行记录经
`data-row-key` → `recordMap` 反查；`contextMenuItems(record)` 返回空数组时该行不包
Dropdown。菜单项点击后按 `key` 找回对应 `onClick`。

#### 1.4.9 自动撑高（ResizeObserver）

`wrapRef` 上挂 ResizeObserver（:599-626）：容器高度 < 200 时不设 `scroll.y`；
否则量出表头与分页器高度，`scroll.y = 容器高 - 表头高 - 分页器高(含 16px 余量)`，
下限 120px；计算经 `requestAnimationFrame` 节流，且新旧值差 ≤ 2px 时不更新
（避免抖动循环）。依赖项含 `pagination`：关闭分页后重新测量。

#### 1.4.10 树形展开（expandAllRows）

antd 的 `defaultExpandAllRows` 只在首渲染取一次，而数据是异步 fetch 的（首渲染为空，
永远折叠）。组件改为受控（:252-274）：数据到达后遍历 `children` 收集所有含子级行的
key 写入 `expandedRowKeys`，用户手动折叠/展开经 `onExpandedRowsChange` 回写。

### 1.5 完整使用示例

以 `frontend/src/pages/system/users/Users.tsx` 为蓝本（搜索 + 列头筛选 + 右键菜单 +
工具栏按钮 + ref reload）：

```tsx
import { useRef } from 'react'
import { Badge, Button } from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import type { DataTableColumn, DataTableRef, SearchField } from '@/components/DataTable'

const SEARCH_FIELDS: SearchField[] = [
  { key: 'username', label: '用户名', type: 'input' },
  { key: 'role', label: '角色', type: 'select', options: ROLE_OPTIONS },
]

const columns: DataTableColumn<UserItem>[] = [
  { key: 'username', title: '用户名', width: 140, filterType: 'text' },
  { key: 'name', title: '姓名', width: 120, sort: true },              // 可点击三态排序
  {
    key: 'role', title: '角色', width: 120,
    filterType: 'select', filterOptions: ROLE_OPTIONS,                  // 列头 select 筛选
    render: (r) => <Badge color="var(--color-primary)" text={r.role} />,
  },
  { key: 'createdAt', title: '创建时间', width: 170, sort: 'desc' },    // 初始降序
  {
    key: '__actions', title: '操作', width: 120, fixed: 'right',
    resizable: false,                                                   // 操作列禁调宽
    render: (record) => (/* 编辑 / 删除按钮 */),
  },
]

export default function Users() {
  const tableRef = useRef<DataTableRef>(null)
  return (
    <DataTable<UserItem>
      ref={tableRef}
      title="用户管理"
      rowKey="id"
      storageKey="system-users"          // 持久化到 localStorage: dt:system-users
      columns={columns}
      searchFields={SEARCH_FIELDS}
      fetchData={async ({ page, size, search, filters }) => {
        const res = await fetchUsers({
          current: page, pageSize: size,
          username: search.username || undefined,
          filters: { ...filters, ...(search.role ? { role: [search.role] } : {}) },
        })
        return { list: res.data, total: res.total }
      }}
      toolbarActions={
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新建用户</Button>
      }
      contextMenuItems={(record) => [
        { key: 'edit', label: '编辑用户', icon: <Pencil size={14} />, onClick: () => openEdit(record) },
        { key: 'delete', label: '删除用户', icon: <Trash2 size={14} />, danger: true,
          onClick: () => handleDelete(record.id) },
      ]}
    />
  )
}
```

要点提醒：

- `storageKey` 全局唯一，两个页面共用一个 key 会互相串列设置。
- 排序/筛选只作用于当前页数据；需要全量语义时在 `fetchData` 里自行实现。
- 增删改完成后调 `tableRef.current?.reload()` 刷新，重置搜索用 `resetSearch()`。

---

## 2. FormModal —— schema 驱动的弹窗表单

源码：`frontend/src/components/FormModal/FormModal.tsx`（197 行）。
定位：替代 `@ant-design/pro-components` 的 ModalForm + ProFormXxx，只依赖
antd 的 `Modal + Form + Row/Col`。

### 2.1 Props

`FormModalProps`（FormModal.tsx:37-47）：

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 弹窗标题 |
| `open` | `boolean` | — | 受控开关 |
| `onOpenChange` | `(open: boolean) => void` | — | 关闭时回调（取消/确定成功后调用） |
| `fields` | `FormModalField[]` | — | 字段配置 |
| `onFinish` | `(values) => Promise<boolean \| void> \| boolean \| void` | — | 提交回调，语义见 2.3 |
| `initialValues` | `Record<string, any>` | — | 编辑回显；`open` 重新打开时重置表单并回显 |
| `width` | `number` | 560 | 弹窗宽度 |
| `okText` | `string` | `'确定'` | 确定按钮文案（取消固定「取消」） |

### 2.2 FormModalField 全字段

`FormModalField`（FormModal.tsx:14-35）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 表单字段名 |
| `label` | `string` | 标签 |
| `type` | `'input' \| 'password' \| 'textarea' \| 'number' \| 'select' \| 'date' \| 'dateRange'` | 控件类型 |
| `span` | `number` | Col 栅格（24 制），默认 12（一行两个）；`textarea` 默认 24 |
| `required` | `boolean` | 自动合成一条 required rule（message 按控件类型生成，见下） |
| `rules` | `any[]` | 额外 antd rules，与自动 required 合并（已有 required 则不重复加） |
| `options` | `{ label; value }[]` | select 选项 |
| `showSearch` | `boolean` | select 可搜索（`optionFilterProp="label"`） |
| `multiple` | `boolean` | select 多选模式 |
| `visibleWhen` | `(values) => boolean` | 条件渲染：返回 false 不渲染也不参与校验（全表单 `useWatch` 驱动） |
| `min` / `max` | `number` | number 的最小/最大值 |
| `precision` | `number` | number 精度 |
| `rows` | `number` | textarea 行数，默认 3 |
| `placeholder` | `string` | 缺省 `${动词}${label}`；动词按类型：input/password/textarea/number=「请输入」，select/date/dateRange=「请选择」（`ACTION_VERB`，FormModal.tsx:50-58） |

控件映射（`FieldControl`，FormModal.tsx:65-110）：password→`Input.Password`，
textarea→`Input.TextArea`，number→`InputNumber`（宽 100%），select→`Select`，
date→`DatePicker`，dateRange→`DatePicker.RangePicker`，其余→`Input`。

> 实现注意（源码注释，FormModal.tsx:60-64）：`Form.Item` 通过 `cloneElement` 向直接
> 子组件注入 `value/onChange`，自定义控件必须接收并透传，否则值注册不进表单，
> 表现为「填了还说没填」。改这个文件时不要丢掉 `{...bind}`。

### 2.3 onFinish 语义（与 ModalForm 等价）

`handleOk`（FormModal.tsx:141-161）流程：

```
点确定 → form.validateFields()（失败：红字提示，不关闭）
       → await onFinish(values)
       → 返回值 !== false：关闭弹窗 + resetFields
       → 返回值 === false：不关闭（调用方自己 message 提示原因）
       → onFinish 抛错：捕获、不关闭（同样由调用方提示）
```

提交中确定按钮 `confirmLoading`。`open` 重新打开时 `resetFields()` 并按最新
`initialValues` 回显（用 ref 取最新值，避免每次渲染重置用户输入，:130-139）。
弹窗 `destroyOnHidden`。

---

## 3. SchemaForm —— 全局 Schema 表单渲染器

源码：`frontend/src/components/SchemaForm/SchemaForm.tsx`（渲染）、`model.ts`（schema 模型）。

定位：表单中心配置 → 全业务按 code 复用的表单渲染器。约定（组件头注释）：
任何业务页面需要表单时，先在「审批管理 → 表单中心」配置表单，再用
`<SchemaForm formCode="LEAVE_APPLY" mode="edit" onSubmit={...} />` 引用；
后续调整表单（增删字段/改宽度/改选项）不需要改业务代码。

未引入 `@formily/react` 的原因（头注释）：`@formily/antd-v5` 对 antd 6 的兼容性未验证
（peer 依赖 antd ^5），为避免构建/运行风险，用约百行代码手写 x-component → antd 映射。

### 3.1 Props

`SchemaFormProps`（SchemaForm.tsx:54-66）：

| Prop | 类型 | 说明 |
|---|---|---|
| `schema` | `FormSchemaV2 \| FormSchema`（旧） | 直接传 schema 渲染，**优先级高于 formCode** |
| `formCode` | `string` | 表单中心的全局 code，内部按 code 拉取**启用状态**表单的 schema（`GET /system/forms/code/{code}`） |
| `mode` | `'edit' \| 'readonly'` | edit=可交互表单；readonly=只读回显（`Descriptions` 单列带边框） |
| `form` | `FormInstance` | 外部受控表单实例 |
| `initialValues` | `Record<string, unknown>` | 初始值 / 只读回显的数据 |
| `onFinish` | `(values) => void` | 提交回调 |
| `onSubmit` | `(values) => void` | `onFinish` 的别名，按 code 引用时推荐；两个都会调 |

加载中显示 Spin；按 code 找不到启用表单时显示 `Empty`（「未找到启用的表单：{code}」）。

### 3.2 v2 schema 模型

`model.ts` 定义（存储于后端 `form_definition.schema` jsonb，后端无需感知结构）：

```ts
FormSchemaV2 { version: 2, children: CanvasNode[] }
CanvasNode  = SectionNode | FieldNode

SectionNode {                  // 容器：只嵌字段，不可嵌容器（insertNode 直接拒绝）
  id, kind: 'section',
  sectionType: 'group' | 'block',   // group=带标题的分区 / block=虚线边框区块，可复制
  title, children: FieldNode[]
}

FieldNode {
  id, kind: 'field', type: FieldType,
  key,                // 表单内唯一，小写字母开头 + 小写/数字/下划线（KEY_PATTERN）
  title,
  span: 1|2|3|4,      // 4 列栅格占几列（渲染端 ×6 映射 antd 24 栅格）
  placeholder?, required?, defaultValue?,
  options?,           // 静态选项 {label, value}[]
  dataSource?,        // 接口数据源，见 3.5
  height?,            // placeholder 高度 px（40-400，默认 80）
  tip?,               // text 提示控件的文本
  min?, max?,         // number/money/percent
  rows?,              // textarea 行数，默认 3
  level?              // title 标题级别 1-3，默认 2
}
```

旧版 Formily 风格 schema（`{type:'object', properties:{...}}`）由渲染端 fallback
分支直接渲染；设计器载入时经 `legacyToCanvas` 转换（24 栅格 → 4 列：12→2 列、
8/6→1 列、其他→4 列），保存即升级为 v2（model.ts:330-385）。

### 3.3 字段类型清单（FieldType）

model.ts:15-36，共 21 种；中文名见 `FIELD_META`（model.ts:124-146）：

| 分类 | 类型 | 渲染（edit 模式） |
|---|---|---|
| 输入 | `input` | `Input` |
| | `textarea` | `Input.TextArea`（rows 默认 3） |
| | `number` | `InputNumber`（宽 100%，min/max） |
| | `money` | `InputNumber`，前缀 ¥、min 默认 0、precision 2 |
| | `percent` | `InputNumber`，后缀 %、min 0 / max 100 |
| 选择 | `select` | `Select`（allowClear） |
| | `selectSearch` | `Select` + `showSearch`（按 label 过滤） |
| | `multiSelect` | `Select mode="multiple"` |
| | `radio` | `Radio.Group` |
| | `checkbox` | `Checkbox.Group` |
| | `memberSelect` | 多选 `Select`，选项拉 `/system/users`，失败降级本地 MEMBERS 名单 |
| 日期 | `date` | `DatePicker`（宽 100%） |
| | `dateRange` | `DatePicker.RangePicker` |
| 其他 | `switch` | `Switch`（`valuePropName="checked"`） |
| | `rate` | `Rate` |
| | `slider` | `Slider`（min/max） |
| | `upload` | `Upload`，`beforeUpload={() => false}`（不自动上传）、maxCount 5 |
| 辅助（纯展示） | `placeholder` | 空白占位块（height 可调），不占表单值 |
| | `divider` | `Divider` |
| | `text` | `Alert type="info"` 提示条（内容取 `tip`） |
| | `title` | `Typography.Title`（level 1-3） |

`SELECT_TYPES = select/selectSearch/multiSelect/radio/checkbox` 共用数据源配置；
`DISPLAY_TYPES = divider/text/title` 无表单值、key 自动生成、不参与 key 唯一性校验。

### 3.4 span 栅格

画布与容器内部均为 **4 列栅格**，字段 `span` 1-4 表示占几列；渲染端 `span * 6`
映射 antd 24 栅格（`FieldCol`，SchemaForm.tsx:275）。展示类控件默认 span=4，
输入类默认 span=1（`createFieldNode`，model.ts:157-185）。

### 3.5 数据源（静态 / 接口）

`FieldDataSource`（model.ts:44-54），仅 select 系五类控件生效：

```ts
{
  mode: 'static' | 'api'
  url?: string         // GET 接口地址（相对 /api 或绝对）
  resultPath?: string  // 从返回 JSON 取数组的点路径，如 data.list（getByPath 支持 a.b.c）
  labelField?: string  // 数组元素里哪个字段做 label
  valueField?: string  // 哪个字段做 value
}
```

- `static`：直接用字段上的 `options`。
- `api`：组件挂载后 `request.get(url)` → `getByPath(body, resultPath)` 取数组 →
  每项按 `labelField/valueField` 映射成选项（`useFieldOptions`，SchemaForm.tsx:73-115）。
  **请求失败或路径下不是数组时降级为空选项**（console.warn，不阻塞表单）。
- 只读回显不拉接口：select 系仅用静态 `options` 把 value 翻译成 label，
  接口选项直接回显原值（`optionLabel`，SchemaForm.tsx:364-371）。
- api 模式下 url/resultPath/labelField/valueField 四项均必填（`dataSourceError`，
  model.ts:318-326）。

### 3.6 edit / readonly 模式差异

- `edit`：渲染 `Form layout="vertical"` + `Row gutter=16`；required 字段合成
  `请填写${title}` 规则；提交时 onFinish/onSubmit 都回调。
- `readonly`：拍平所有字段（容器不展示为分区），过滤掉
  `placeholder/divider/text/title`，渲染 `Descriptions column={1} bordered`。
  值格式化（`formatValueV2`）：dayjs→`YYYY-MM-DD`、dateRange→`起 ~ 止`、
  数组→`、`连接、switch→是/否、rate→`N 星`、money→`¥千分位`、percent→`N%`、
  空值→`-`。

### 3.7 formCode 按码加载（表单中心统一维护的用法）

```tsx
// 业务页面：只管 code 与提交回调，表单长什么样由表单中心决定
<SchemaForm formCode="LEAVE_APPLY" mode="edit" onSubmit={(values) => ...} />

// 设计器预览等场景：直接传 schema
<SchemaForm schema={schema} mode="edit" />

// 审批详情回显
<SchemaForm schema={detail.formSchema} mode="readonly" initialValues={detail.instance.formData} />
```

按 code 链路：`fetchFormByCode(code)` → `GET /system/forms/code/{code}`（后端
`FormController.getByCode` 只返回 `status='启用'` 的表单，否则 404）。实际用例：
`frontend/src/pages/approval/forms/FormCenter.tsx` 的预览弹窗、
`frontend/src/pages/approval/launch/Launch.tsx` 的发起弹窗、
`frontend/src/pages/approval/center/ApprovalCenter.tsx` 的详情抽屉与重新提交弹窗。
