/**
 * DataTable —— schema 驱动的终版表格组件
 * 能力：服务端分页、可折叠搜索区、工具栏（刷新/列设置/全屏）、
 * 列头拖拽换序、列头筛选（select/text）、列设置面板（显隐+排序+重置）、
 * localStorage 持久化（dt:${storageKey}）、行右键菜单、ResizeObserver 自动撑高。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Checkbox, Dropdown, Input, Popover, Select, Table, Tooltip } from 'antd'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Filter,
  GripVertical,
  Maximize,
  Minimize,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
} from 'lucide-react'
import './DataTable.css'

export interface DataTableColumn<T> {
  key: string
  title: string
  width?: number
  align?: 'left' | 'center' | 'right'
  fixed?: 'left' | 'right'
  /** 排序配置（替代 antd sorter）：
   * - true：允许用户点击表头循环（默认无图标 → 升序 → 降序 → 默认）
   * - 'asc' / 'desc'：按该方向作为初始排序（仍可点击循环）
   * - 函数：自定义比较器（可点击循环）
   * 不传则不可排序 */
  sort?: boolean | 'asc' | 'desc' | ((a: T, b: T) => number)
  /** 列头筛选：select = checkbox 列表 + 重置；text = 输入框 */
  filterType?: 'select' | 'text'
  /** select 筛选的可选项，缺省时从当前数据去重生成 */
  filterOptions?: { label: string; value: any }[]
  render?: (record: T, index: number) => React.ReactNode
  defaultHidden?: boolean
  /** 是否允许拖拽调宽（默认 true 即可调宽） */
  resizable?: boolean
}

export interface SearchField {
  key: string
  label: string
  type: 'input' | 'select'
  options?: { label: string; value: any }[]
  placeholder?: string
}

export interface ContextMenuItem {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  onClick: () => void
}

export interface DataTableRef {
  reload: () => void
  resetSearch: () => void
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  fetchData: (params: {
    page: number
    size: number
    search: Record<string, any>
    filters: Record<string, any[]>
  }) => Promise<{ list: T[]; total: number }>
  searchFields?: SearchField[]
  title?: React.ReactNode
  /** 工具栏左侧按钮（新增/导出等） */
  toolbarActions?: React.ReactNode
  rowKey: string
  /** 列设置持久化 key（必传，避免冲突），实际存储 key 为 dt:${storageKey} */
  storageKey: string
  contextMenuItems?: (record: T) => ContextMenuItem[]
  onRowClick?: (record: T) => void
  pageSize?: number
  /** 传 false 关闭分页（如树形菜单表） */
  pagination?: false
  /** 树形数据默认展开所有行 */
  expandAllRows?: boolean
  /** 嵌在卡片内时使用，去掉自身玻璃底 */
  flat?: boolean
}

interface ColDef<T> extends DataTableColumn<T> {
  visible: boolean
}

interface SavedCol {
  key: string
  visible: boolean
  /** 用户拖拽调整过的列宽 */
  width?: number
}

function loadColDefs<T>(columns: DataTableColumn<T>[], storageKey: string): ColDef<T>[] {
  const fresh = () => columns.map((c) => ({ ...c, visible: !c.defaultHidden }))
  try {
    const raw = localStorage.getItem(`dt:${storageKey}`)
    if (!raw) return fresh()
    const saved: SavedCol[] = JSON.parse(raw)
    if (!Array.isArray(saved)) return fresh()
    const merged: ColDef<T>[] = []
    saved.forEach((s) => {
      const def = columns.find((c) => c.key === s.key)
      if (def) merged.push({ ...def, visible: s.visible, width: s.width ?? def.width })
    })
    columns.forEach((c) => {
      if (!merged.find((m) => m.key === c.key)) merged.push({ ...c, visible: !c.defaultHidden })
    })
    return merged
  } catch {
    return fresh()
  }
}

function defaultCompare<T>(key: string) {
  return (a: T, b: T) => {
    const va = (a as Record<string, any>)[key]
    const vb = (b as Record<string, any>)[key]
    if (typeof va === 'number' && typeof vb === 'number') return va - vb
    return String(va ?? '').localeCompare(String(vb ?? ''), 'zh-CN')
  }
}

function DataTableInner<T>(props: DataTableProps<T>, ref: React.Ref<DataTableRef>) {
  const {
    columns,
    fetchData,
    searchFields,
    title,
    toolbarActions,
    rowKey,
    storageKey,
    contextMenuItems,
    onRowClick,
    pageSize = 10,
    pagination,
    expandAllRows,
    flat,
  } = props

  /* ---------------- 数据 ---------------- */
  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState({ page: 1, size: pageSize })
  const [searchValues, setSearchValues] = useState<Record<string, any>>({})
  const [appliedSearch, setAppliedSearch] = useState<Record<string, any>>({})
  const [selectFilters, setSelectFilters] = useState<Record<string, any[]>>({})
  const [textFilters, setTextFilters] = useState<Record<string, string>>({})
  /* 自定义排序（替代 antd sorter）：{ key, order } | null；初始值取列配置 sort:'asc'/'desc' */
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(() => {
    const initial = columns.find((c) => c.sort === 'asc' || c.sort === 'desc')
    return initial ? { key: initial.key, order: initial.sort as 'asc' | 'desc' } : null
  })

  // 列配置变化时重新应用初始排序
  const sortSig = columns.map((c) => `${c.key}:${c.sort ?? ''}`).join('|')
  useEffect(() => {
    const initial = columns.find((c) => c.sort === 'asc' || c.sort === 'desc')
    setSort(initial ? { key: initial.key, order: initial.sort as 'asc' | 'desc' } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortSig])

  const fetchRef = useRef(fetchData)
  fetchRef.current = fetchData

  const mergedFilters = useMemo(() => {
    const filters: Record<string, any[]> = { ...selectFilters }
    Object.entries(textFilters).forEach(([k, v]) => {
      if (v) filters[k] = [v]
    })
    return filters
  }, [selectFilters, textFilters])

  /* 排序后的展示数据（对当前页数据排序；col.sort 为函数时用自定义比较器） */
  const sortedData = useMemo(() => {
    if (!sort) return data
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return data
    const compare = typeof col.sort === 'function' ? col.sort : defaultCompare<T>(col.key)
    const sorted = [...data].sort(compare)
    return sort.order === 'desc' ? sorted.reverse() : sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort, columns])

  /** 表头点击循环排序：默认 → 升序 → 降序 → 默认 */
  function cycleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, order: 'asc' }
      if (prev.order === 'asc') return { key, order: 'desc' }
      return null
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchRef.current({
        page: query.page,
        size: query.size,
        search: appliedSearch,
        filters: mergedFilters,
      })
      setData(res.list)
      setTotal(res.total)
    } catch (e) {
      console.error('[DataTable] fetchData 失败', e)
    } finally {
      setLoading(false)
    }
  }, [query, appliedSearch, mergedFilters])

  useEffect(() => {
    load()
  }, [load])

  const reload = useCallback(() => load(), [load])

  const handleSearch = useCallback(() => {
    setAppliedSearch({ ...searchValues })
    setQuery((q) => ({ ...q, page: 1 }))
  }, [searchValues])

  const resetSearch = useCallback(() => {
    setSearchValues({})
    setAppliedSearch({})
    setSelectFilters({})
    setTextFilters({})
    setQuery((q) => ({ ...q, page: 1 }))
  }, [])

  useImperativeHandle(ref, () => ({ reload, resetSearch }), [reload, resetSearch])

  /* ---------------- 树形展开（expandAllRows） ----------------
   * defaultExpandAllRows 只在首渲染取一次 key，而表格数据是异步 fetch 的，
   * 首渲染时 data 为空 → 永远是折叠态。改为受控：数据到达后展开全部含子级的行，
   * 用户仍可手动折叠/展开（onExpandedRowsChange 回写）。 */
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  useEffect(() => {
    if (!expandAllRows) return
    const keyOf = (row: T): React.Key =>
      typeof rowKey === 'function'
        ? (rowKey as (r: T) => React.Key)(row)
        : ((row as Record<string, unknown>)[rowKey as string] as React.Key)
    const keys: React.Key[] = []
    const walk = (rows: T[]) =>
      rows.forEach((row) => {
        const children = (row as Record<string, unknown>).children as T[] | undefined
        if (Array.isArray(children) && children.length > 0) {
          keys.push(keyOf(row))
          walk(children)
        }
      })
    walk(data)
    setExpandedKeys(keys)
  }, [data, expandAllRows, rowKey])

  /* ---------------- 搜索区折叠 ---------------- */
  const [searchCollapsed, setSearchCollapsed] = useState(true)
  const hasSearchCondition =
    Object.values(searchValues).some((v) => v !== undefined && v !== null && v !== '') ||
    Object.keys(mergedFilters).length > 0

  /* ---------------- 列定义（顺序 + 显隐，持久化） ---------------- */
  const [colDefs, setColDefs] = useState<ColDef<T>[]>(() => loadColDefs(columns, storageKey))

  // columns 变化（按 key+title 签名判断）时重新合并（保留已保存的顺序与显隐）
  const columnsSig = columns.map((c) => `${c.key}:${c.title}`).join('|')
  useEffect(() => {
    setColDefs(loadColDefs(columns, storageKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsSig, storageKey])

  useEffect(() => {
    try {
      localStorage.setItem(
        `dt:${storageKey}`,
        JSON.stringify(colDefs.map((c) => ({ key: c.key, visible: c.visible, width: c.width }))),
      )
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [colDefs, storageKey])

  const resetColumns = useCallback(() => {
    setColDefs(columns.map((c) => ({ ...c, visible: !c.defaultHidden })))
    try {
      localStorage.removeItem(`dt:${storageKey}`)
    } catch {
      /* ignore */
    }
  }, [columns, storageKey])

  /* ---------------- 列拖拽（表头 + 设置面板共用） ---------------- */
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  /* ---------------- 列宽拖拽调整 ---------------- */
  const resizeState = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const onResizeStart = useCallback((key: string, width: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeState.current = { key, startX: e.clientX, startWidth: width }

    const onMove = (ev: MouseEvent) => {
      const s = resizeState.current
      if (!s) return
      const next = Math.max(60, s.startWidth + (ev.clientX - s.startX))
      setColDefs((prev) => prev.map((c) => (c.key === s.key ? { ...c, width: next } : c)))
    }
    const onUp = () => {
      resizeState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const moveColumn = useCallback((fromKey: string | null, toKey: string) => {
    if (!fromKey || fromKey === toKey) return
    setColDefs((prev) => {
      const list = [...prev]
      const fromIdx = list.findIndex((c) => c.key === fromKey)
      const toIdx = list.findIndex((c) => c.key === toKey)
      if (fromIdx < 0 || toIdx < 0) return prev
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      return list
    })
  }, [])

  const onDragStart = (key: string, e: React.DragEvent) => {
    setDragKey(key)
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (key: string, e: React.DragEvent) => {
    e.preventDefault()
    if (dragKey && dragKey !== key) {
      setDragOverKey(key)
      e.dataTransfer.dropEffect = 'move'
    }
  }
  const onDrop = (key: string, e: React.DragEvent) => {
    e.preventDefault()
    moveColumn(dragKey, key)
    setDragKey(null)
    setDragOverKey(null)
  }
  const onDragEnd = () => {
    setDragKey(null)
    setDragOverKey(null)
  }

  /* ---------------- 列头筛选 ---------------- */
  const isFilterActive = (key: string) =>
    (selectFilters[key]?.length ?? 0) > 0 || !!textFilters[key]

  const distinctValues = (key: string) => {
    const set = new Set<any>()
    data.forEach((row) => set.add((row as Record<string, any>)[key]))
    return [...set].filter((v) => v !== undefined && v !== null && v !== '')
  }

  const renderHeaderTitle = (col: ColDef<T>) => {
    const resizable = col.resizable !== false
    const resizer = resizable ? (
      <span
        className="dt-col-resizer"
        title="拖拽调整列宽"
        onMouseDown={(e) => onResizeStart(col.key, col.width ?? 140, e)}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      />
    ) : null
    // 列拖拽手柄（th 不可拖，只从这里发起，避免 draggable 吞掉排序点击）
    const dragHandle = (
      <span
        className="dt-drag-handle"
        title="拖拽调整列顺序"
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          onDragStart(col.key, e)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </span>
    )
    // 排序指示：默认不显示图标；升序 ArrowUpNarrowWide / 降序 ArrowDownWideNarrow
    const sortIcon = col.sort ? (
      <span className="dt-sort-icon">
        {sort?.key === col.key && sort.order === 'asc' && <ArrowUpNarrowWide size={13} />}
        {sort?.key === col.key && sort.order === 'desc' && <ArrowDownWideNarrow size={13} />}
      </span>
    ) : null
    const titleEl = (
      <span
        className={`dt-header-text ${col.sort ? 'is-sortable' : ''}`}
        onClick={
          col.sort
            ? (e) => {
                e.stopPropagation()
                cycleSort(col.key)
              }
            : undefined
        }
      >
        {col.title}
        {sortIcon}
      </span>
    )
    if (!col.filterType)
      return (
        <span className="dt-header-inner">
          {dragHandle}
          {titleEl}
          {resizer}
        </span>
      )
    const active = isFilterActive(col.key)
    const options = col.filterOptions ?? distinctValues(col.key).map((v) => ({ label: String(v), value: v }))
    const content =
      col.filterType === 'select' ? (
        <div className="dt-filter-panel">
          <div className="dt-filter-checkbox-list">
            {options.map((o) => (
              <Checkbox
                key={String(o.value)}
                checked={(selectFilters[col.key] ?? []).includes(o.value)}
                onChange={(e) => {
                  const cur = new Set(selectFilters[col.key] ?? [])
                  if (e.target.checked) cur.add(o.value)
                  else cur.delete(o.value)
                  setSelectFilters((prev) => ({ ...prev, [col.key]: [...cur] }))
                  setQuery((q) => ({ ...q, page: 1 }))
                }}
              >
                {o.label}
              </Checkbox>
            ))}
            {options.length === 0 && <div className="dt-filter-empty">暂无可选值</div>}
          </div>
          <div className="dt-filter-footer">
            <Button
              size="small"
              type="link"
              onClick={() => {
                setSelectFilters((prev) => ({ ...prev, [col.key]: [] }))
                setQuery((q) => ({ ...q, page: 1 }))
              }}
            >
              重置
            </Button>
          </div>
        </div>
      ) : (
        <div className="dt-filter-panel">
          <Input
            size="small"
            allowClear
            placeholder={`搜索${col.title}`}
            value={textFilters[col.key] ?? ''}
            onChange={(e) => {
              setTextFilters((prev) => ({ ...prev, [col.key]: e.target.value }))
              setQuery((q) => ({ ...q, page: 1 }))
            }}
          />
        </div>
      )
    return (
      <span className="dt-header-inner">
        {dragHandle}
        {titleEl}
        <Popover trigger="click" placement="bottomLeft" content={content}>
          <span
            className={`dt-filter-icon ${active ? 'is-active' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <Filter size={12} />
          </span>
        </Popover>
        {resizer}
      </span>
    )
  }

  /* ---------------- antd 列 ---------------- */
  const antdColumns = useMemo(
    () =>
      colDefs
        .filter((c) => c.visible)
        .map((col) => ({
          key: col.key,
          dataIndex: col.key,
          width: col.width,
          align: col.align,
          fixed: col.fixed,
          title: () => renderHeaderTitle(col),
          render: col.render
            ? (_: unknown, record: T, index: number) => col.render!(record, index)
            : undefined,
          onHeaderCell: () => ({
            // 不在 th 上设 draggable（Chrome 下 draggable 会吞掉 click，排序点不动），
            // 拖拽改由标题里的专用拖拽手柄发起
            className: [
              'dt-draggable-header',
              dragKey === col.key ? 'is-dragging' : '',
              dragOverKey === col.key ? 'is-drag-over' : '',
            ]
              .filter(Boolean)
              .join(' '),
            onDragOver: (e: React.DragEvent) => onDragOver(col.key, e),
            onDrop: (e: React.DragEvent) => onDrop(col.key, e),
            onDragEnd,
          }),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colDefs, dragKey, dragOverKey, selectFilters, textFilters, data, sort],
  )

  const scrollX = useMemo(
    () => colDefs.filter((c) => c.visible).reduce((sum, c) => sum + (c.width ?? 140), 0),
    [colDefs],
  )

  /* ---------------- 行右键菜单 ---------------- */
  const recordMap = useMemo(() => {
    const map = new Map<string, T>()
    data.forEach((record) => {
      map.set(String((record as Record<string, any>)[rowKey]), record)
    })
    return map
  }, [data, rowKey])

  const bodyRow = useMemo(() => {
    const Row = (trProps: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: React.Key }) => {
      const record = trProps['data-row-key'] != null ? recordMap.get(String(trProps['data-row-key'])) : undefined
      const items = record && contextMenuItems ? contextMenuItems(record) : []
      if (!items.length) return <tr {...trProps} />
      return (
        <Dropdown
          trigger={['contextMenu']}
          menu={{
            items: items.map((i) => ({ key: i.key, label: i.label, icon: i.icon, danger: i.danger })),
            onClick: ({ key }) => items.find((i) => i.key === key)?.onClick(),
          }}
        >
          <tr {...trProps} />
        </Dropdown>
      )
    }
    return Row as unknown as React.ComponentType<React.HTMLAttributes<HTMLTableRowElement>>
  }, [recordMap, contextMenuItems])

  /* ---------------- 全屏 ---------------- */
  const rootRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) rootRef.current?.requestFullscreen?.()
    else document.exitFullscreen()
  }

  /* ---------------- 自动撑高（ResizeObserver） ---------------- */
  const wrapRef = useRef<HTMLDivElement>(null)
  const [bodyScrollY, setBodyScrollY] = useState<number | undefined>(undefined)

  useEffect(() => {
    const wrapper = wrapRef.current
    if (!wrapper) return
    let rafId = 0
    const update = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const wrapperH = wrapper.getBoundingClientRect().height
        if (wrapperH < 200) {
          setBodyScrollY(undefined)
          return
        }
        const header = wrapper.querySelector('.ant-table-thead') as HTMLElement | null
        const pager = wrapper.querySelector('.ant-table-pagination') as HTMLElement | null
        const headerH = header?.getBoundingClientRect().height ?? 0
        const pagerH = pager ? pager.getBoundingClientRect().height + 16 : 0
        const nextY = Math.max(120, Math.floor(wrapperH - headerH - pagerH))
        setBodyScrollY((prev) => (prev !== undefined && Math.abs(prev - nextY) <= 2 ? prev : nextY))
      })
    }
    const ro = new ResizeObserver(update)
    ro.observe(wrapper)
    update()
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [pagination])

  /* ---------------- 渲染 ---------------- */
  const columnPanel = (
    <div className="dt-column-panel">
      {colDefs.map((col) => (
        <div
          key={col.key}
          className={`dt-column-item ${dragOverKey === col.key && dragKey !== col.key ? 'is-drag-over' : ''}`}
          draggable
          onDragStart={(e) => onDragStart(col.key, e)}
          onDragOver={(e) => {
            e.preventDefault()
            if (dragKey && dragKey !== col.key) setDragOverKey(col.key)
          }}
          onDrop={(e) => onDrop(col.key, e)}
          onDragEnd={onDragEnd}
        >
          <GripVertical size={14} className="dt-drag-handle" />
          <Checkbox
            checked={col.visible}
            onChange={(e) =>
              setColDefs((prev) =>
                prev.map((c) => (c.key === col.key ? { ...c, visible: e.target.checked } : c)),
              )
            }
          >
            {col.title}
          </Checkbox>
        </div>
      ))}
      <div className="dt-panel-tip">拖动调整列顺序，勾选控制显隐</div>
    </div>
  )

  return (
    <div ref={rootRef} className={`dt-root ${flat ? 'dt-flat' : ''}`}>
      {searchFields && searchFields.length > 0 && (
        <div className="dt-search">
          <div className={`dt-search-fields ${searchCollapsed ? 'is-collapsed' : ''}`}>
            {searchFields.map((f) => (
              <div key={f.key} className="dt-search-field">
                <span className="dt-search-label">{f.label}</span>
                {f.type === 'input' ? (
                  <Input
                    allowClear
                    className="dt-search-control"
                    placeholder={f.placeholder ?? `请输入${f.label}`}
                    value={searchValues[f.key] ?? ''}
                    onChange={(e) =>
                      setSearchValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    onPressEnter={handleSearch}
                  />
                ) : (
                  <Select
                    allowClear
                    className="dt-search-control"
                    options={f.options}
                    placeholder={f.placeholder ?? `请选择${f.label}`}
                    value={searchValues[f.key] ?? undefined}
                    onChange={(v) => setSearchValues((prev) => ({ ...prev, [f.key]: v }))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="dt-search-actions">
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
              查询
            </Button>
            <Button icon={<RotateCcw size={14} />} disabled={!hasSearchCondition} onClick={resetSearch}>
              重置
            </Button>
            <a className="dt-collapse-toggle" onClick={() => setSearchCollapsed((v) => !v)}>
              {searchCollapsed ? '展开' : '收起'}
              <ChevronDown size={12} className={`dt-collapse-icon ${searchCollapsed ? '' : 'is-up'}`} />
            </a>
          </div>
        </div>
      )}

      <div className="dt-card">
        <div className="dt-toolbar">
          <div className="dt-toolbar-left">
            {title && <span className="dt-title">{title}</span>}
            {toolbarActions}
          </div>
          <div className="dt-toolbar-right">
            <Tooltip title="刷新">
              <button type="button" className="dt-tool-btn" onClick={reload}>
                <RefreshCw size={15} />
              </button>
            </Tooltip>
            <Popover
              trigger="click"
              placement="bottomRight"
              content={columnPanel}
              title={
                <div className="dt-column-panel-title">
                  <span>列设置</span>
                  <a className="dt-reset-link" onClick={resetColumns}>
                    重置
                  </a>
                </div>
              }
            >
              <Tooltip title="列设置">
                <button type="button" className="dt-tool-btn">
                  <Settings2 size={15} />
                </button>
              </Tooltip>
            </Popover>
            <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
              <button type="button" className="dt-tool-btn" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
              </button>
            </Tooltip>
          </div>
        </div>

        <div ref={wrapRef} className="dt-table-wrap">
          <Table<T>
            columns={antdColumns as any}
            dataSource={sortedData}
            rowKey={rowKey}
            loading={loading}
            size="middle"
            scroll={{ x: scrollX, y: bodyScrollY }}
            components={contextMenuItems ? { body: { row: bodyRow } } : undefined}
            expandable={
              expandAllRows
                ? {
                    expandedRowKeys: expandedKeys,
                    onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
                  }
                : undefined
            }
            onRow={(record) => ({
              onClick: onRowClick ? () => onRowClick(record) : undefined,
              className: onRowClick ? 'dt-row-clickable' : undefined,
            })}
            pagination={
              pagination === false
                ? false
                : {
                    current: query.page,
                    pageSize: query.size,
                    total,
                    showSizeChanger: true,
                    showTotal: (t: number) => `共 ${t} 条`,
                    onChange: (p: number, s: number) =>
                      setQuery({ page: s !== query.size ? 1 : p, size: s }),
                  }
            }
          />
        </div>
      </div>
    </div>
  )
}

export const DataTable = forwardRef(DataTableInner) as <T>(
  props: DataTableProps<T> & { ref?: React.Ref<DataTableRef> },
) => React.ReactElement
