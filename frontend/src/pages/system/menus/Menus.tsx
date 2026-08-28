import { useRef, useState } from 'react'
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Tooltip,
  Radio,
  Select,
  Space,
  Tag,
  TreeSelect,
} from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import type { DataTableColumn, DataTableRef } from '@/components/DataTable'
import {
  createMenu,
  deleteMenuCascade,
  fetchMenus,
  updateMenu,
  type MenuPayload,
} from '@/api/system'
import { buildMenuTree, useMenuStore } from '@/stores/menu'
import { pageComponentPaths, routePathOf } from '@/router/registry'
import { ICON_SUGGESTIONS, renderMenuIcon } from '@/utils/menuIcons'
import type { MenuItem } from '@/mocks/system'

/** 目录蓝 / 菜单绿 / 按钮灰 */
const TYPE_META: Record<MenuItem['type'], { label: string; color: string }> = {
  dir: { label: '目录', color: 'blue' },
  menu: { label: '菜单', color: 'green' },
  button: { label: '按钮', color: 'default' },
}

interface MenuFormValues {
  type: MenuItem['type']
  title: string
  parentId?: number
  path?: string
  perm?: string
  icon?: string
  sort?: number
}

/** 收集某节点全部后代 id（编辑时父级下拉需排除自身及后代，防止成环） */
function collectDescendants(flat: MenuItem[], id: number): Set<number> {
  const out = new Set<number>([id])
  const walk = (pid: number) => {
    flat
      .filter((m) => m.parentId === pid)
      .forEach((c) => {
        out.add(c.id)
        walk(c.id)
      })
  }
  walk(id)
  return out
}

export default function Menus() {
  const { message } = App.useApp()
  const tableRef = useRef<DataTableRef>(null)
  const [flatMenus, setFlatMenus] = useState<MenuItem[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<MenuFormValues>()
  const formType = Form.useWatch('type', form)

  /** 增删改后刷新：表格 + 全局菜单 store（动态路由与侧边栏即时生效） */
  const reloadAll = async () => {
    tableRef.current?.reload()
    await useMenuStore.getState().load(true)
  }

  const openCreate = (parent?: MenuItem) => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      type: parent ? (parent.type === 'dir' ? 'menu' : 'button') : 'dir',
      parentId: parent?.id,
      sort: 0,
    })
    setModalOpen(true)
  }

  const openEdit = (record: MenuItem) => {
    setEditing(record)
    form.resetFields()
    form.setFieldsValue({
      type: record.type,
      title: record.title,
      parentId: record.parentId || undefined,
      path: record.path ?? undefined,
      perm: record.perm ?? undefined,
      icon: record.icon ?? undefined,
      sort: record.sort,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const payload: MenuPayload = {
        parentId: values.parentId ?? 0,
        title: values.title,
        type: values.type,
        // 目录/按钮没有组件地址；目录不带权限码；按钮不需要图标
        path: values.type === 'menu' ? values.path! : null,
        perm: values.type === 'dir' ? null : values.perm || null,
        icon: values.type === 'button' ? null : values.icon || null,
        sort: values.sort ?? 0,
      }
      if (editing) {
        await updateMenu(editing.id, payload)
        message.success(`菜单「${values.title}」已更新`)
      } else {
        await createMenu(payload)
        message.success(`菜单「${values.title}」已创建`)
      }
      setModalOpen(false)
      await reloadAll()
    } catch {
      message.error('保存失败，请检查后端服务后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (record: MenuItem) => {
    try {
      await deleteMenuCascade(record.id)
      message.success(`菜单「${record.title}」已删除`)
      await reloadAll()
    } catch {
      message.error('删除失败，请检查后端服务后重试')
    }
  }

  /** 父级下拉树：目录/菜单可作父级（按钮不可）；编辑时排除自身及后代 */
  const parentTreeData = (() => {
    const excluded = editing ? collectDescendants(flatMenus, editing.id) : new Set<number>()
    const candidates = flatMenus.filter((m) => m.type !== 'button' && !excluded.has(m.id))
    const walk = (nodes: MenuItem[]): any[] =>
      nodes.map((n) => ({
        value: n.id,
        title: `${n.title}（${TYPE_META[n.type].label}）`,
        children: n.children ? walk(n.children) : undefined,
      }))
    return walk(buildMenuTree(candidates))
  })()

  const descendantCount = (record: MenuItem) =>
    collectDescendants(flatMenus, record.id).size - 1

  const columns: DataTableColumn<MenuItem>[] = [
    { key: 'title', title: '菜单', width: 180, filterType: 'text' },
    {
      key: 'type',
      title: '类型',
      width: 90,
      filterType: 'select',
      filterOptions: Object.entries(TYPE_META).map(([value, m]) => ({
        label: m.label,
        value,
      })),
      render: (r) => <Tag color={TYPE_META[r.type].color}>{TYPE_META[r.type].label}</Tag>,
    },
    {
      key: 'icon',
      title: '图标',
      width: 90,
      align: 'center',
      render: (r) =>
        r.icon ? (
          <span title={r.icon}>{renderMenuIcon(r.icon, 15)}</span>
        ) : (
          <span style={{ color: '#98a2b3' }}>-</span>
        ),
    },
    {
      key: 'path',
      title: '组件地址 / 路由地址',
      width: 340,
      render: (r) =>
        r.path ? (
          <Tooltip
            placement="bottomLeft"
            styles={{ root: { maxWidth: 360 } }}
            title={
              <div style={{ textAlign: 'left', lineHeight: 2 }}>
                <div>
                  <span style={{ opacity: 0.65, display: 'inline-block', width: 32, marginRight: 8 }}>
                    组件
                  </span>
                  <code>{r.path}</code>
                </div>
                <div>
                  <span style={{ opacity: 0.65, display: 'inline-block', width: 32, marginRight: 8 }}>
                    路由
                  </span>
                  <code>{routePathOf(r.path)}</code>
                </div>
              </div>
            }
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 8,
                maxWidth: '100%',
                cursor: 'default',
              }}
            >
              <code>{routePathOf(r.path)}</code>
              <span
                style={{
                  color: '#98a2b3',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.path}
              </span>
            </span>
          </Tooltip>
        ) : (
          <span style={{ color: '#98a2b3' }}>-</span>
        ),
    },
    {
      key: 'perm',
      title: '权限码',
      width: 180,
      render: (r) => (r.perm ? <code>{r.perm}</code> : <span style={{ color: '#98a2b3' }}>-</span>),
    },
    { key: 'sort', title: '排序', width: 70, sort: true },
    {
      key: '__actions',
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (record) => (
        <Space size={4}>
          {record.type !== 'button' && (
            <Button
              type="text"
              size="small"
              icon={<Plus size={14} />}
              title="新增子项"
              onClick={() => openCreate(record)}
            />
          )}
          <Button
            type="text"
            size="small"
            icon={<Pencil size={14} />}
            title="编辑"
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title={
              descendantCount(record) > 0
                ? `确认删除「${record.title}」？将级联删除 ${descendantCount(record)} 个子项`
                : `确认删除「${record.title}」？`
            }
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} title="删除" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-fill">
      <DataTable<MenuItem>
        ref={tableRef}
        title="菜单管理"
        rowKey="id"
        storageKey="system-menus-v2"
        columns={columns}
        pagination={false}
        expandAllRows
        fetchData={async () => {
          const flat = await fetchMenus()
          setFlatMenus(flat)
          const tree = buildMenuTree(flat)
          return { list: tree, total: flat.length }
        }}
        toolbarActions={
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openCreate()}>
            新增菜单
          </Button>
        }
      />

      <Modal
        title={editing ? `编辑菜单「${editing.title}」` : '新增菜单'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ sort: 0 }}>
          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: '目录', value: 'dir' },
                { label: '菜单', value: 'menu' },
                { label: '按钮', value: 'button' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="title"
            label="菜单标题"
            rules={[{ required: true, message: '请输入菜单标题' }]}
          >
            <Input placeholder="如：用户管理" maxLength={32} />
          </Form.Item>

          <Form.Item name="parentId" label="父级（不选则为顶级目录）">
            <TreeSelect
              treeData={parentTreeData}
              placeholder="选择父级目录/菜单"
              allowClear
              showSearch
              treeNodeFilterProp="title"
              treeDefaultExpandAll
            />
          </Form.Item>

          {formType === 'menu' && (
            <Form.Item
              name="path"
              label="组件地址"
              tooltip="相对 src/pages 的组件文件路径，路由地址取其所在目录"
              rules={[{ required: true, message: '请选择组件地址' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="搜索并选择页面组件"
                options={pageComponentPaths.map((p) => ({
                  label: `${p}（${routePathOf(p)}）`,
                  value: p,
                }))}
              />
            </Form.Item>
          )}

          {(formType === 'menu' || formType === 'button') && (
            <Form.Item
              name="perm"
              label="权限码"
              rules={
                formType === 'button'
                  ? [{ required: true, message: '请输入权限码' }]
                  : undefined
              }
            >
              <Input placeholder={formType === 'button' ? '如 system:user:add' : '如 system:xxx:list（留空则登录即可见）'} />
            </Form.Item>
          )}

          {formType !== 'button' && (
            <Form.Item name="icon" label="图标（lucide 图标名）">
              <AutoComplete
                placeholder="如 LayoutDashboard，缺省用 File 兜底"
                options={ICON_SUGGESTIONS.map((name) => ({
                  value: name,
                  label: (
                    <Space size={8}>
                      {renderMenuIcon(name, 14)}
                      <span>{name}</span>
                    </Space>
                  ),
                }))}
                filterOption={(input, option) =>
                  (option?.value as string).toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
          )}

          <Form.Item name="sort" label="排序号">
            <InputNumber min={0} max={9999} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
