import { useRef, useState } from 'react'
import { App, Badge, Button, Form, Input, Modal, Popconfirm, Select, Space } from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import type { DataTableColumn, DataTableRef, SearchField } from '@/components/DataTable'
import {
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
} from '@/api/system'
import type { UserItem } from '@/mocks/system'

const ROLE_OPTIONS = ['平台超管', '部门负责人', '普通员工', '访客'].map(
  (r) => ({ label: r, value: r }),
)

const STATUS_FILTER_OPTIONS = [
  { label: '启用', value: '1' },
  { label: '禁用', value: '0' },
]

const SEARCH_FIELDS: SearchField[] = [
  { key: 'username', label: '用户名', type: 'input', placeholder: '登录用户名' },
  { key: 'name', label: '姓名', type: 'input', placeholder: '真实姓名' },
  { key: 'role', label: '角色', type: 'select', options: ROLE_OPTIONS },
]

export default function Users() {
  const { message } = App.useApp()
  const tableRef = useRef<DataTableRef>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UserItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<UserItem>()

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (record: UserItem) => {
    setEditing(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await updateUser(editing.id, values)
        message.success('用户已更新（mock）')
      } else {
        await createUser(values)
        message.success('用户已创建（mock）')
      }
      setModalOpen(false)
      tableRef.current?.reload()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    await deleteUser(id)
    message.success('用户已删除（mock）')
    tableRef.current?.reload()
  }

  const columns: DataTableColumn<UserItem>[] = [
    { key: 'id', title: 'ID', width: 64 },
    { key: 'username', title: '用户名', width: 140, filterType: 'text' },
    { key: 'name', title: '姓名', width: 120, filterType: 'text' },
    { key: 'phone', title: '手机号', width: 140 },
    {
      key: 'role',
      title: '角色',
      width: 120,
      filterType: 'select',
      filterOptions: ROLE_OPTIONS,
      render: (r) => <Badge color="var(--color-primary)" text={r.role} />,
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      align: 'center',
      filterType: 'select',
      filterOptions: STATUS_FILTER_OPTIONS,
      render: (r) =>
        r.status === 1 ? (
          <Badge status="success" text="启用" />
        ) : (
          <Badge status="default" text="禁用" />
        ),
    },
    { key: 'createdAt', title: '创建时间', width: 170 },
    {
      key: '__actions',
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (record) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<Pencil size={14} />}
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="确认删除该用户？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-fill">
      <DataTable<UserItem>
        ref={tableRef}
        title="用户管理"
        rowKey="id"
        storageKey="system-users"
        columns={columns}
        searchFields={SEARCH_FIELDS}
        fetchData={async ({ page, size, search, filters }) => {
          const res = await fetchUsers({
            current: page,
            pageSize: size,
            username: search.username || undefined,
            name: search.name || undefined,
            filters: { ...filters, ...(search.role ? { role: [search.role] } : {}) },
          })
          return { list: res.data, total: res.total }
        }}
        toolbarActions={
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
            新建用户
          </Button>
        }
        contextMenuItems={(record) => [
          {
            key: 'edit',
            label: '编辑用户',
            icon: <Pencil size={14} />,
            onClick: () => openEdit(record),
          },
          {
            key: 'delete',
            label: '删除用户',
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => handleDelete(record.id),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="登录用户名" />
          </Form.Item>
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="真实姓名" />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="手机号" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select options={ROLE_OPTIONS} placeholder="选择角色" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
