import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Drawer, Empty, Input, Popconfirm, Spin, Tree } from 'antd'
import { KeyRound, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { FormModal, type FormModalField } from '@/components/FormModal'
import {
  createRole,
  deleteRole,
  fetchDeptOptions,
  fetchPermissionTree,
  fetchRolePermissions,
  fetchRoles,
  saveRolePermissions,
  updateRole,
} from '@/api/system'
import {
  DATA_SCOPE_META,
  type DataScope,
  type PermissionNode,
  type RoleItem,
} from '@/mocks/system'
import './roles.css'

/** 数据范围 Tag（色系由 roles.css 的 scope-{tone} 提供，走主题变量） */
function ScopeTag({ scope }: { scope: DataScope }) {
  const meta = DATA_SCOPE_META[scope] ?? DATA_SCOPE_META.SELF
  return <span className={`scope-tag scope-${meta.tone}`}>{meta.label}</span>
}

export default function Roles() {
  const { message } = App.useApp()
  const [roles, setRoles] = useState<RoleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')

  // 新建/编辑弹窗
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RoleItem | null>(null)
  const [deptOptions, setDeptOptions] = useState<{ label: string; value: number }[]>([])

  // 权限配置 Drawer
  const [permDrawerOpen, setPermDrawerOpen] = useState(false)
  const [permRole, setPermRole] = useState<RoleItem | null>(null)
  const [permTree, setPermTree] = useState<PermissionNode[]>([])
  const [checkedKeys, setCheckedKeys] = useState<number[]>([])
  const [savingPerms, setSavingPerms] = useState(false)

  const loadRoles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchRoles({ current: 1, pageSize: 200 })
      setRoles(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRoles()
    fetchDeptOptions().then(setDeptOptions)
    fetchPermissionTree().then(setPermTree)
  }, [loadRoles])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return roles
    return roles.filter(
      (r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw),
    )
  }, [roles, keyword])

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (record: RoleItem) => {
    setEditing(record)
    setModalOpen(true)
  }

  const openPermDrawer = async (record: RoleItem) => {
    setPermRole(record)
    setPermDrawerOpen(true)
    setCheckedKeys(await fetchRolePermissions(record.id))
  }

  const handleSubmit = async (values: Record<string, any>) => {
    const payload: Partial<RoleItem> = {
      name: values.name,
      code: values.code,
      dataScope: values.dataScope,
      // 非 CUSTOM 档清空自定义部门集合
      deptIds: values.dataScope === 'CUSTOM' ? (values.deptIds ?? []) : null,
      description: values.description,
    }
    if (editing) {
      await updateRole(editing.id, payload)
      message.success(`角色「${payload.name}」已更新`)
    } else {
      await createRole(payload)
      message.success(`角色「${payload.name}」已创建`)
    }
    await loadRoles()
  }

  const handleDelete = async (record: RoleItem) => {
    await deleteRole(record.id)
    message.success(`角色「${record.name}」已删除`)
    await loadRoles()
  }

  const handleSavePermissions = async () => {
    if (!permRole) return
    setSavingPerms(true)
    try {
      await saveRolePermissions(permRole.id, checkedKeys)
      message.success(`已保存「${permRole.name}」的权限配置`)
      setPermDrawerOpen(false)
    } finally {
      setSavingPerms(false)
    }
  }

  const formFields: FormModalField[] = [
    {
      name: 'name',
      label: '角色名称',
      type: 'input',
      required: true,
      placeholder: '如：部门负责人',
    },
    {
      name: 'code',
      label: '角色编码',
      type: 'input',
      required: true,
      placeholder: '如：DEPT_LEADER',
    },
    {
      name: 'dataScope',
      label: '数据范围',
      type: 'select',
      span: 24,
      required: true,
      options: (Object.keys(DATA_SCOPE_META) as DataScope[]).map((key) => ({
        label: `${DATA_SCOPE_META[key].label} — ${DATA_SCOPE_META[key].desc}`,
        value: key,
      })),
    },
    {
      name: 'deptIds',
      label: '自定义部门（数据范围为「自定义」时生效）',
      type: 'select',
      span: 24,
      multiple: true,
      required: true,
      options: deptOptions,
      placeholder: '请选择可见部门',
      visibleWhen: (values) => values.dataScope === 'CUSTOM',
    },
    {
      name: 'description',
      label: '描述',
      type: 'textarea',
      span: 24,
      placeholder: '角色职责说明',
    },
  ]

  return (
    <div className="page-fill roles-page">
      <div className="roles-toolbar">
        <div>
          <h2 className="roles-title">角色权限</h2>
          <p className="roles-sub">共 {filtered.length} 个角色，点击卡片配置权限</p>
        </div>
        <div className="roles-toolbar-actions">
          <Input
            allowClear
            prefix={<Search size={14} />}
            placeholder="搜索角色名 / 编码"
            style={{ width: 220 }}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
            新建角色
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <div className="roles-grid">
          {filtered.map((role) => (
            <div key={role.id} className="role-card" onClick={() => openPermDrawer(role)}>
              <div className="role-card-head">
                <span className="role-card-name" title={role.name}>
                  {role.name}
                </span>
                <ScopeTag scope={role.dataScope} />
              </div>
              <span className="role-card-code">{role.code}</span>
              <p className="role-card-desc">{role.description || '暂无描述'}</p>
              <div className="role-card-foot">
                <span className="role-card-members">
                  <Users size={13} />
                  {role.userCount != null ? `${role.userCount} 名成员` : '成员数未知'}
                </span>
                <span className="role-card-actions" onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="text"
                    size="small"
                    icon={<KeyRound size={14} />}
                    onClick={() => openPermDrawer(role)}
                  >
                    权限配置
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<Pencil size={14} />}
                    onClick={() => openEdit(role)}
                  />
                  <Popconfirm
                    title={`确认删除角色「${role.name}」？`}
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => handleDelete(role)}
                  >
                    <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                  </Popconfirm>
                </span>
              </div>
            </div>
          ))}

          <button type="button" className="role-card-create" onClick={openCreate}>
            <Plus size={18} />
            新建角色
          </button>

          {!loading && filtered.length === 0 && (
            <div className="roles-empty">
              <Empty description="没有匹配的角色" />
            </div>
          )}
        </div>
      </Spin>

      <FormModal
        title={editing ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onOpenChange={setModalOpen}
        fields={formFields}
        initialValues={editing ?? { dataScope: 'SELF' }}
        onFinish={handleSubmit}
        okText="保存"
      />

      <Drawer
        title={permRole ? `权限配置：${permRole.name}` : '权限配置'}
        width={400}
        open={permDrawerOpen}
        onClose={() => setPermDrawerOpen(false)}
        extra={
          <Button type="primary" loading={savingPerms} onClick={handleSavePermissions}>
            保存
          </Button>
        }
      >
        {permRole && (
          <div className="perm-drawer-meta">
            <ScopeTag scope={permRole.dataScope} />
            <span>{DATA_SCOPE_META[permRole.dataScope]?.desc}</span>
          </div>
        )}
        <Tree
          className="perm-drawer-tree"
          checkable
          defaultExpandAll
          treeData={permTree}
          checkedKeys={checkedKeys}
          onCheck={(keys) => {
            // 非 checkStrictly 模式返回纯选中 keys（半选父节点不计入）
            const list = Array.isArray(keys) ? keys : keys.checked
            setCheckedKeys(list.map(Number))
          }}
        />
      </Drawer>
    </div>
  )
}
