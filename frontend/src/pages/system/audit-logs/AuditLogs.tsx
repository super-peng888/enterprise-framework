import { Tag } from 'antd'
import { DataTable } from '@/components/DataTable'
import type { DataTableColumn, SearchField } from '@/components/DataTable'
import { fetchAuditLogs } from '@/api/system'
import type { AuditLogItem } from '@/mocks/system'

const ACTION_COLOR: Record<string, string> = {
  新增用户: 'green',
  修改用户: 'orange',
  禁用用户: 'red',
  修改角色: 'orange',
  新增角色: 'green',
  更新菜单: 'geekblue',
  提交审批: 'geekblue',
  审批通过: 'green',
  审批驳回: 'red',
  发布表单: 'cyan',
  导出日志: 'purple',
}

const SEARCH_FIELDS: SearchField[] = [
  { key: 'operator', label: '操作人', type: 'input' },
  { key: 'module', label: '模块', type: 'input' },
  {
    key: 'action',
    label: '动作',
    type: 'select',
    options: Object.keys(ACTION_COLOR).map((a) => ({ label: a, value: a })),
  },
]

export default function AuditLogs() {
  const columns: DataTableColumn<AuditLogItem>[] = [
    { key: 'id', title: 'ID', width: 64 },
    { key: 'operator', title: '操作人', width: 110, filterType: 'text' },
    { key: 'module', title: '模块', width: 110, filterType: 'text' },
    {
      key: 'action',
      title: '动作',
      width: 110,
      filterType: 'select',
      render: (r) => <Tag color={ACTION_COLOR[r.action] ?? 'default'}>{r.action}</Tag>,
    },
    { key: 'summary', title: '变更摘要' },
    { key: 'ip', title: 'IP', width: 120, defaultHidden: true },
    { key: 'createdAt', title: '时间', width: 170 },
  ]

  return (
    <div className="page-fill">
      <DataTable<AuditLogItem>
        title="审计日志"
        rowKey="id"
        storageKey="system-audit-logs"
        columns={columns}
        searchFields={SEARCH_FIELDS}
        fetchData={async ({ page, size, search, filters }) => {
          const res = await fetchAuditLogs({
            current: page,
            pageSize: size,
            operator: search.operator || undefined,
            module: search.module || undefined,
            filters: { ...filters, ...(search.action ? { action: [search.action] } : {}) },
          })
          return { list: res.data, total: res.total }
        }}
      />
    </div>
  )
}
