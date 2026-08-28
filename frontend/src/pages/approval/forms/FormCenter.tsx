/**
 * 全局表单中心：列表视图（DataTable）+ 设计视图（FormDesigner）。
 * 列表展示表单 code / 名称 / 状态 / 更新时间，操作：设计 / 预览 / 删除；
 * 「新建表单」需填全局唯一 code（小写字母开头 + 小写字母/数字/下划线）。
 * 业务页面通过 <SchemaForm formCode="xxx" /> 引用这里配置的表单。
 */
import { useCallback, useRef, useState } from 'react'
import { App, Badge, Button, Form, Input, Modal, Popconfirm } from 'antd'
import { Eye, FilePlus2, PencilLine, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import type { DataTableColumn, DataTableRef } from '@/components/DataTable'
import SchemaForm from '@/components/SchemaForm'
import FormDesigner from './FormDesigner'
import { createForm, deleteForm, ensureSystemToken, fetchForms } from '@/api/approval'
import { applyColumnFilters } from '@/api/system'
import type { FormDef } from '@/mocks/approval'
import './forms.css'

/** 表单 code：字母开头，仅限字母 / 数字 / 下划线（兼容存量大写风格如 REBATE_APPLY） */
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

export default function FormCenter() {
  const { message } = App.useApp()
  const tableRef = useRef<DataTableRef>(null)
  const [designing, setDesigning] = useState<FormDef | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [previewCode, setPreviewCode] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState('')
  const [createFormInst] = Form.useForm<{ code: string; name: string }>()
  const [previewForm] = Form.useForm()

  const reload = useCallback(() => {
    tableRef.current?.reload()
  }, [])

  /* ---------------- 新建表单 ---------------- */

  const handleCreate = async () => {
    const values = await createFormInst.validateFields()
    setCreating(true)
    try {
      await createForm({
        code: values.code,
        name: values.name,
        schema: { version: 2, children: [] },
      })
      message.success('表单已创建，进入设计')
      setCreateOpen(false)
      createFormInst.resetFields()
      // 找到新建表单进入设计视图
      const list = await fetchForms()
      const target = list.find((f) => f.code === values.code)
      if (target) setDesigning(target)
      else reload()
    } finally {
      setCreating(false)
    }
  }

  /* ---------------- 删除 ---------------- */

  const handleDelete = async (record: FormDef) => {
    await deleteForm(record.id)
    message.success(`表单「${record.name}」已删除`)
    reload()
  }

  /* ---------------- 列定义 ---------------- */

  const columns: DataTableColumn<FormDef>[] = [
    { key: 'code', title: '表单 Code', width: 180, filterType: 'text' },
    { key: 'name', title: '表单名称', filterType: 'text' },
    {
      key: 'status',
      title: '状态',
      width: 90,
      align: 'center',
      render: (r) =>
        r.status === 1 ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />,
    },
    { key: 'updatedAt', title: '更新时间', width: 170, render: (r) => r.updatedAt ?? '-' },
    {
      key: '__actions',
      title: '操作',
      width: 200,
      render: (record) => (
        <div className="fc-actions">
          <Button
            type="link"
            size="small"
            icon={<PencilLine size={13} />}
            onClick={() => setDesigning(record)}
          >
            设计
          </Button>
          <Button
            type="link"
            size="small"
            icon={<Eye size={13} />}
            onClick={() => {
              setPreviewCode(record.code)
              setPreviewName(record.name)
            }}
          >
            预览
          </Button>
          <Popconfirm
            title={`确认删除表单「${record.name}」？`}
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" size="small" danger icon={<Trash2 size={13} />} />
          </Popconfirm>
        </div>
      ),
    },
  ]

  /* ---------------- 设计视图 ---------------- */

  if (designing) {
    return (
      <FormDesigner
        key={designing.id}
        form={designing}
        onBack={() => {
          setDesigning(null)
          reload()
        }}
        onSaved={() => {
          // 保存成功后刷新列表数据，返回列表时即为最新
          reload()
        }}
      />
    )
  }

  /* ---------------- 列表视图 ---------------- */

  return (
    <div className="form-center page-fill">
      <div className="core-card form-center-card">
        <DataTable<FormDef>
          ref={tableRef}
          flat
          title="表单注册中心"
          rowKey="id"
          storageKey="approval-forms"
          columns={columns}
          fetchData={async ({ page, size, filters }) => {
            ensureSystemToken()
            const list = applyColumnFilters(await fetchForms(), filters)
            return { list: list.slice((page - 1) * size, page * size), total: list.length }
          }}
          toolbarActions={
            <Button type="primary" icon={<FilePlus2 size={14} />} onClick={() => setCreateOpen(true)}>
              新建表单
            </Button>
          }
          onRowClick={(record) => setDesigning(record)}
        />
      </div>

      {/* 新建表单：code 全局唯一 */}
      <Modal
        open={createOpen}
        title="新建表单"
        okText="创建并设计"
        cancelText="取消"
        confirmLoading={creating}
        destroyOnHidden
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
      >
        <Form form={createFormInst} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="code"
            label="表单 Code（全局唯一，业务页面按此引用）"
            rules={[
              { required: true, message: '请填写表单 Code' },
              { pattern: CODE_PATTERN, message: '字母开头，仅限字母 / 数字 / 下划线' },
              {
                validator: async (_, value: string) => {
                  if (!value) return
                  try {
                    const list = await fetchForms()
                    if (list.some((f) => f.code === value)) {
                      throw new Error('该 Code 已被占用')
                    }
                  } catch (e) {
                    // 唯一性预检失败（如后端未启动）不阻塞提交，由后端唯一约束兜底
                    if (e instanceof Error && e.message === '该 Code 已被占用') throw e
                  }
                },
              },
            ]}
          >
            <Input placeholder="如 LEAVE_APPLY 或 expense_apply" />
          </Form.Item>
          <Form.Item
            name="name"
            label="表单名称"
            rules={[{ required: true, message: '请填写表单名称' }]}
          >
            <Input placeholder="如 请假申请" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 预览：演示按 code 加载表单（SchemaForm formCode 链路） */}
      <Modal
        open={!!previewCode}
        title={`表单预览 · ${previewName}（按 code「${previewCode}」加载）`}
        width={640}
        okText="提交"
        cancelText="关闭"
        destroyOnHidden
        onCancel={() => setPreviewCode(null)}
        onOk={() => previewForm.submit()}
      >
        {previewCode && (
          <SchemaForm
            formCode={previewCode}
            mode="edit"
            form={previewForm}
            onSubmit={(values) => {
              message.success('预览提交成功，数据见控制台')
              console.log(`[表单预览提交 code=${previewCode}]`, values)
              setPreviewCode(null)
            }}
          />
        )}
      </Modal>
    </div>
  )
}
