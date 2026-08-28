/**
 * 审批流程设计器 —— 基于 @xyflow/react（React Flow）画布
 * 树形数据由 layout.ts 布局为 nodes/edges（节点不可拖动，结构变更自动重排）；
 * 点击节点/分支卡片在右侧抽屉配置；边中点「+」插入节点；左侧为流程列表。
 * 流程 ↔ 表单绑定：顶部「关联表单」写入 flow.formId，保存时后端自动维护审批模板 FLOW_{id}；
 * 条件分支的触发条件字段从关联表单的 schema 字段中取（无绑定时降级固定字段）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Drawer, Empty, Input, Modal, Radio, Select, Space, Switch } from 'antd'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Code,
  Plus,
  Save,
  Settings2,
  Trash2,
  Workflow,
} from 'lucide-react'
import { flowEdgeTypes } from './InsertEdge'
import { flowNodeTypes } from './FlowNodes'
import { layoutFlow } from './layout'
import {
  addBranchTo,
  CONDITION_FIELDS,
  CONDITION_OPS,
  countIncomplete,
  createCondition,
  createNode,
  ensureIds,
  getBranch,
  getNode,
  insertNodeAt,
  removeBranchAt,
  removeNodeAt,
  reorderBranches,
  ROOT_LIST,
  updateBranch,
  updateNode,
  type Branch,
  type FlowNode,
  type NodeType,
} from './flow'
import {
  createFlow,
  ensureSystemToken,
  fetchFlows,
  fetchForms,
  fetchRoleOptions,
  fetchUserOptions,
  updateFlow,
} from '@/api/approval'
import type { FlowDef, FormDef, FormSchema } from '@/mocks/approval'
import { collectFields, isDisplayType, isV2Schema, toCanvasChildren } from '@/components/SchemaForm/model'
import './designer.css'

type Selected = { kind: 'node' | 'branch'; id: string } | null

/** 可作为触发条件的字段类型（数值/文本/下拉类） */
const CONDITION_FIELD_TYPES = new Set(['number', 'money', 'percent', 'input', 'select'])

/** 旧版 Formily 组件 → 条件字段类型映射 */
const LEGACY_CONDITION_COMPONENTS = new Set(['InputNumber', 'Money', 'Percent', 'Input', 'Select'])

/** 从表单 schema 提取条件字段选项（label=字段标题，value=字段 key）；取不到返回 null */
function conditionFieldsOfForm(form: FormDef | null): { label: string; value: string }[] | null {
  if (!form) return null
  const schema = form.schema
  if (isV2Schema(schema)) {
    return collectFields(schema.children)
      .filter((f) => CONDITION_FIELD_TYPES.has(f.type))
      .map((f) => ({ label: f.title, value: f.key }))
  }
  const legacy = schema as FormSchema
  if (legacy?.type === 'object' && legacy.properties) {
    return Object.entries(legacy.properties)
      .filter(([, p]) => LEGACY_CONDITION_COMPONENTS.has(p['x-component']))
      .map(([key, p]) => ({ label: p.title ?? key, value: key }))
  }
  return null
}

const NODE_TYPE_NAME: Record<NodeType, string> = {
  approver: '审批人节点',
  cc: '抄送人节点',
  condition: '条件分支',
}

/** 按分支 id 找到所属条件节点及分支下标（抽屉内分支上移/下移用） */
function findBranchCtx(
  nodes: FlowNode[],
  branchId: string,
): { nodeId: string; index: number; branches: Branch[] } | null {
  for (const n of nodes) {
    const branches = n.branches ?? []
    const index = branches.findIndex((b) => b.id === branchId)
    if (index >= 0) return { nodeId: n.id, index, branches }
    for (const b of branches) {
      const found = findBranchCtx(b.children, branchId)
      if (found) return found
    }
  }
  return null
}

/** 画布内层：结构变化（节点数变化）后重新 fitView，MiniMap 可收折 */
function FlowCanvas({
  rfNodes,
  rfEdges,
}: {
  rfNodes: ReturnType<typeof layoutFlow>['nodes']
  rfEdges: ReturnType<typeof layoutFlow>['edges']
}) {
  const { fitView } = useReactFlow()
  const [miniOpen, setMiniOpen] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => {
      fitView({ padding: 0.15, maxZoom: 1, duration: 200 })
    }, 50)
    return () => clearTimeout(t)
  }, [rfNodes.length, fitView])

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={flowNodeTypes}
      edgeTypes={flowEdgeTypes}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      minZoom={0.1}
      maxZoom={1.5}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
      <Controls showInteractive={false} position="bottom-left" />
      <Panel position="bottom-right" className="flow-minimap-panel">
        <div className="flow-minimap-head">
          <span>小地图</span>
          <button
            type="button"
            className="flow-minimap-toggle"
            title={miniOpen ? '收起小地图' : '展开小地图'}
            onClick={() => setMiniOpen((v) => !v)}
          >
            {miniOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
        {miniOpen && <MiniMap pannable zoomable />}
      </Panel>
    </ReactFlow>
  )
}

export default function FlowDesigner() {
  const { message } = App.useApp()
  const [flowList, setFlowList] = useState<FlowDef[]>([])
  const [flowId, setFlowId] = useState<number | null>(null)
  const [flowName, setFlowName] = useState('未命名流程')
  const [formId, setFormId] = useState<number | null>(null)
  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [selected, setSelected] = useState<Selected>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [forms, setForms] = useState<FormDef[]>([])
  const [userOptions, setUserOptions] = useState<{ label: string; value: string }[]>([])
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([])

  const loadList = useCallback(async (selectId?: number) => {
    const list = await fetchFlows()
    setFlowList(list)
    const target = list.find((f) => f.id === selectId) ?? list[0]
    if (target) {
      setFlowId(target.id)
      setFlowName(target.name)
      setFormId(target.formId ?? null)
      setNodes(ensureIds(JSON.parse(JSON.stringify(target.flowJson)) as FlowNode[]))
    }
  }, [])

  useEffect(() => {
    ensureSystemToken()
    loadList()
    fetchForms().then(setForms)
    fetchUserOptions().then(setUserOptions)
    fetchRoleOptions().then(setRoleOptions)
  }, [loadList])

  const incompleteCount = useMemo(() => countIncomplete(nodes), [nodes])

  const selectedNode = selected?.kind === 'node' ? getNode(nodes, selected.id) : null
  const selectedBranch = selected?.kind === 'branch' ? getBranch(nodes, selected.id) : null

  /** 选中分支的所属条件节点与下标（抽屉内上移/下移用） */
  const selectedBranchCtx = useMemo(
    () => (selected?.kind === 'branch' ? findBranchCtx(nodes, selected.id) : null),
    [nodes, selected],
  )

  /** 当前流程关联的表单（条件字段来源 / 列表绑定标签共用） */
  const boundForm = useMemo(
    () => (formId != null ? (forms.find((f) => f.id === formId) ?? null) : null),
    [formId, forms],
  )

  /** 条件分支的字段下拉：有绑定表单取表单字段，否则降级固定字段列表 */
  const conditionFieldOptions = useMemo(() => {
    const fromForm = conditionFieldsOfForm(boundForm)
    if (fromForm) return fromForm
    return CONDITION_FIELDS.map((f) => ({ label: f, value: f }))
  }, [boundForm])

  /** 字段权限配置的字段来源：绑定表单的全部录入字段（排除纯展示控件，兼容旧 schema） */
  const permFields = useMemo(() => {
    if (!boundForm) return []
    return collectFields(toCanvasChildren(boundForm.schema)).filter((f) => !isDisplayType(f.type))
  }, [boundForm])

  /** 写入节点字段权限：readonly=从 map 移除（缺省只读），editable/hidden 落进 fieldPerms */
  const handleFieldPermChange = (nodeId: string, key: string, perm: 'readonly' | 'editable' | 'hidden') => {
    setNodes((p) => {
      const node = getNode(p, nodeId)
      const next = { ...(node?.fieldPerms ?? {}) }
      if (perm === 'readonly') delete next[key]
      else next[key] = perm
      return updateNode(p, nodeId, { fieldPerms: Object.keys(next).length ? next : undefined })
    })
  }

  /* ---------------- 结构操作 ---------------- */

  const handleInsert = (containerId: string, index: number, type: NodeType) => {
    setNodes((prev) => insertNodeAt(prev, containerId, index, type))
  }

  const handleRemove = (containerId: string, index: number) => {
    const list = containerId === ROOT_LIST ? nodes : getBranch(nodes, containerId)?.children
    const removed = list?.[index]
    if (removed && selected?.id === removed.id) setSelected(null)
    setNodes((prev) => removeNodeAt(prev, containerId, index))
  }

  const handleAddBranch = (nodeId: string) => {
    setNodes((prev) => addBranchTo(prev, nodeId))
  }

  const handleRemoveBranch = (nodeId: string, index: number) => {
    const branch = getNode(nodes, nodeId)?.branches?.[index]
    if (branch && selected?.id === branch.id) setSelected(null)
    setNodes((prev) => removeBranchAt(prev, nodeId, index))
  }

  const handleReorderBranch = (nodeId: string, fromIndex: number, toIndex: number) => {
    setNodes((prev) => reorderBranches(prev, nodeId, fromIndex, toIndex))
  }

  /* ---------------- 画布布局 ---------------- */

  const { nodes: rfNodes, edges: rfEdges } = useMemo(
    () =>
      layoutFlow(nodes, selected?.id, {
        onSelectNode: (id) => setSelected({ kind: 'node', id }),
        onSelectBranch: (id) => setSelected({ kind: 'branch', id }),
        onRemoveNode: handleRemove,
        onRemoveBranch: handleRemoveBranch,
        onAddBranch: handleAddBranch,
        onInsert: handleInsert,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, selected],
  )

  /* ---------------- 新建 / 载入 / 保存 ---------------- */

  const handleCreate = () => {
    setFlowId(null)
    setFlowName('未命名流程')
    setFormId(null)
    setNodes([createNode('approver')])
    setSelected(null)
  }

  const handleLoad = (flow: FlowDef) => {
    setFlowId(flow.id)
    setFlowName(flow.name)
    setFormId(flow.formId ?? null)
    // 补全 id：存量数据可能缺节点/分支/条件 id，缺失会导致分支内插入定位错乱
    setNodes(ensureIds(JSON.parse(JSON.stringify(flow.flowJson)) as FlowNode[]))
    setSelected(null)
  }

  const handleSave = async () => {
    if (!flowName.trim()) {
      message.warning('请填写流程名称')
      return
    }
    if (incompleteCount > 0) {
      message.warning(`还有 ${incompleteCount} 个节点未配置完整`)
      return
    }
    setSaving(true)
    try {
      if (flowId) {
        await updateFlow(flowId, { name: flowName, flowJson: nodes, formId })
        message.success(
          formId != null ? `已保存，审批模板 FLOW_${flowId} 已同步` : '流程已保存',
        )
        await loadList(flowId)
      } else {
        const res = (await createFlow({ name: flowName, flowJson: nodes, formId })) as {
          id?: number
        }
        message.success(
          formId != null && res?.id != null
            ? `已保存，审批模板 FLOW_${res.id} 已同步`
            : '流程已创建',
        )
        await loadList(res?.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const flowJson = useMemo(
    () => JSON.stringify({ name: flowName, formId, nodes }, null, 2),
    [flowName, formId, nodes],
  )

  return (
    <div className="flow-designer">
      {/* 左侧流程列表 */}
      <div className="core-card flow-list-panel">
        <div className="flow-list-head">
          <span className="flow-list-title">流程列表</span>
          <Button size="small" type="primary" icon={<Plus size={13} />} onClick={handleCreate}>
            新建
          </Button>
        </div>
        {flowList.length > 0 ? (
          flowList.map((f) => {
            const fForm = f.formId != null ? forms.find((x) => x.id === f.formId) : null
            return (
              <div
                key={f.id}
                className={`flow-list-item ${f.id === flowId ? 'is-active' : ''}`}
                onClick={() => handleLoad(f)}
              >
                <Workflow size={15} className="flow-list-item-icon" />
                <div className="flow-list-item-info">
                  <div className="flow-list-item-name">{f.name}</div>
                  <div className="flow-list-item-desc">{f.flowJson.length} 个顶层节点</div>
                  {f.formId != null ? (
                    <span className="flow-list-form-tag">{fForm?.name ?? `表单 #${f.formId}`}</span>
                  ) : (
                    <span className="flow-list-form-tag is-unbound">未绑定表单</span>
                  )}
                </div>
              </div>
            )
          })
        ) : (
          <Empty description="暂无流程" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>

      {/* 右侧设计器 */}
      <div className="flow-designer-main">
        <div className="core-card flow-toolbar">
          <div className="flow-toolbar-left">
            <span className="flow-toolbar-label">流程名称</span>
            <Input
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              style={{ width: 200 }}
            />
            <span className="flow-toolbar-label">关联表单</span>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 200 }}
              placeholder="选择关联表单"
              value={formId ?? undefined}
              onChange={(v) => setFormId(v ?? null)}
              options={forms
                .filter((f) => f.status === 1 || (f.status as unknown) === '启用')
                .map((f) => ({ label: `${f.name}（${f.code}）`, value: f.id }))}
            />
            {!formId && (
              <span className="flow-warn-badge">未关联表单，保存后不会生成审批模板</span>
            )}
            {incompleteCount > 0 && (
              <span className="flow-warn-badge">{incompleteCount} 个节点待完善</span>
            )}
          </div>
          <div className="flow-toolbar-right">
            <Button icon={<Code size={14} />} onClick={() => setJsonOpen(true)}>
              查看 JSON
            </Button>
            <Button type="primary" icon={<Save size={14} />} loading={saving} onClick={handleSave}>
              保存流程
            </Button>
          </div>
        </div>

        <div className="flow-canvas">
          <ReactFlowProvider>
            <FlowCanvas rfNodes={rfNodes} rfEdges={rfEdges} />
          </ReactFlowProvider>
        </div>
      </div>

      {/* 配置抽屉（分节式） */}
      <Drawer
        open={!!selected && !!(selectedNode || selectedBranch)}
        title={
          selected?.kind === 'branch'
            ? '条件分支'
            : selectedNode
              ? NODE_TYPE_NAME[selectedNode.type]
              : '节点设置'
        }
        width={400}
        onClose={() => setSelected(null)}
      >
        {selectedNode?.type === 'approver' && (
          <>
            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">审批人</div>
              <div className="flow-form-item">
                <div className="flow-form-label">节点名称</div>
                <Input
                  value={selectedNode.name}
                  onChange={(e) =>
                    setNodes((p) => updateNode(p, selectedNode.id, { name: e.target.value }))
                  }
                />
              </div>
              <div className="flow-form-item">
                <Radio.Group
                  value={selectedNode.approverType}
                  onChange={(e) =>
                    setNodes((p) =>
                      updateNode(p, selectedNode.id, { approverType: e.target.value, approvers: [] }),
                    )
                  }
                  options={[
                    { label: '指定成员', value: 'member' },
                    { label: '指定角色', value: 'role' },
                    { label: '部门负责人', value: 'deptLeader' },
                  ]}
                />
              </div>
              {selectedNode.approverType === 'member' && (
                <div className="flow-form-item" style={{ marginBottom: 0 }}>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    style={{ width: '100%' }}
                    placeholder="搜索并选择审批成员"
                    value={selectedNode.approvers}
                    onChange={(v) => setNodes((p) => updateNode(p, selectedNode.id, { approvers: v }))}
                    options={userOptions}
                  />
                </div>
              )}
              {selectedNode.approverType === 'role' && (
                <div className="flow-form-item" style={{ marginBottom: 0 }}>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    style={{ width: '100%' }}
                    placeholder="拥有该角色的成员审批"
                    value={selectedNode.approvers}
                    onChange={(v) => setNodes((p) => updateNode(p, selectedNode.id, { approvers: v }))}
                    options={roleOptions}
                  />
                  <div className="flow-form-tip">按角色编码保存，显示为角色名称</div>
                </div>
              )}
            </div>

            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">审批方式</div>
              <Radio.Group
                value={selectedNode.signMode}
                disabled={(selectedNode.approvers?.length ?? 0) <= 1}
                onChange={(e) =>
                  setNodes((p) => updateNode(p, selectedNode.id, { signMode: e.target.value }))
                }
                options={[
                  { label: '或签（一人同意即可）', value: 'or' },
                  { label: '会签（所有人同意）', value: 'all' },
                ]}
              />
              {(selectedNode.approvers?.length ?? 0) <= 1 && (
                <div className="flow-form-tip">单个审批人时无需选择，添加多个审批人后可选</div>
              )}
            </div>

            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">加签设置</div>
              <div className="flow-switch-row">
                <Switch
                  checked={selectedNode.allowAddSign ?? true}
                  onChange={(v) =>
                    setNodes((p) => updateNode(p, selectedNode.id, { allowAddSign: v }))
                  }
                />
                <span className="flow-form-tip" style={{ marginTop: 0 }}>
                  允许审批人加签（前加签/后加签）
                </span>
              </div>
            </div>

            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">字段权限</div>
              {!boundForm ? (
                <div className="flow-form-tip">流程未绑定表单，无法配置字段权限</div>
              ) : permFields.length === 0 ? (
                <div className="flow-form-tip">绑定表单暂无可配置字段</div>
              ) : (
                <>
                  {permFields.map((f) => (
                    <div key={f.id} className="flow-field-perm-row">
                      <span className="flow-field-perm-name" title={f.key}>
                        {f.title}
                      </span>
                      <Radio.Group
                        size="small"
                        value={selectedNode.fieldPerms?.[f.key] ?? 'readonly'}
                        onChange={(e) =>
                          handleFieldPermChange(selectedNode.id, f.key, e.target.value)
                        }
                        options={[
                          { label: '只读', value: 'readonly' },
                          { label: '可编辑', value: 'editable' },
                          { label: '隐藏', value: 'hidden' },
                        ]}
                      />
                    </div>
                  ))}
                  <div className="flow-form-tip">
                    审批人处理待办时：可编辑字段可随「同意」提交修改，隐藏字段不展示
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {selectedNode?.type === 'cc' && (
          <div className="flow-drawer-section">
            <div className="flow-drawer-section-title">抄送对象</div>
            <div className="flow-form-item">
              <div className="flow-form-label">节点名称</div>
              <Input
                value={selectedNode.name}
                onChange={(e) =>
                  setNodes((p) => updateNode(p, selectedNode.id, { name: e.target.value }))
                }
              />
            </div>
            <div className="flow-form-item" style={{ marginBottom: 0 }}>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                placeholder="搜索并选择抄送成员"
                value={selectedNode.ccUsers}
                onChange={(v) => setNodes((p) => updateNode(p, selectedNode.id, { ccUsers: v }))}
                options={userOptions}
              />
              <div className="flow-form-tip">流程通过后自动通知</div>
            </div>
          </div>
        )}

        {selectedNode?.type === 'condition' && (
          <>
            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">节点名称</div>
              <Input
                value={selectedNode.name}
                onChange={(e) =>
                  setNodes((p) => updateNode(p, selectedNode.id, { name: e.target.value }))
                }
              />
            </div>
            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">
                分支管理（按顺序匹配，默认分支固定最后）
              </div>
              {(selectedNode.branches ?? []).map((b, bi, branches) => (
                <div key={b.id} className="flow-branch-row">
                  <Input
                    size="small"
                    value={b.name}
                    disabled={b.isDefault}
                    onChange={(e) =>
                      setNodes((p) => updateBranch(p, b.id, { name: e.target.value }))
                    }
                  />
                  {b.isDefault ? (
                    <span className="flow-branch-default-tag">默认</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flow-branch-row-btn"
                        title="上移"
                        disabled={bi === 0}
                        onClick={() => handleReorderBranch(selectedNode.id, bi, bi - 1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="flow-branch-row-btn"
                        title="下移"
                        disabled={
                          bi >= branches.length - 1 || (branches[bi + 1]?.isDefault ?? false)
                        }
                        onClick={() => handleReorderBranch(selectedNode.id, bi, bi + 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="flow-branch-row-btn"
                        title="条件配置"
                        onClick={() => setSelected({ kind: 'branch', id: b.id })}
                      >
                        <Settings2 size={13} />
                      </button>
                      {branches.length > 2 && (
                        <button
                          type="button"
                          className="flow-branch-row-btn is-danger"
                          title="删除分支"
                          onClick={() => handleRemoveBranch(selectedNode.id, bi)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
              <Button
                size="small"
                type="dashed"
                block
                icon={<Plus size={13} />}
                onClick={() => handleAddBranch(selectedNode.id)}
              >
                添加分支
              </Button>
              <div className="flow-form-tip">
                分支的触发条件：点行内「条件配置」或画布上的分支卡片编辑
              </div>
            </div>
          </>
        )}

        {selectedBranch && (
          <>
            <div className="flow-drawer-section">
              <div className="flow-drawer-section-title">分支名称</div>
              <Input
                value={selectedBranch.name}
                disabled={selectedBranch.isDefault}
                onChange={(e) =>
                  setNodes((p) => updateBranch(p, selectedBranch.id, { name: e.target.value }))
                }
              />
            </div>
            {selectedBranchCtx && !selectedBranch.isDefault && (
              <div className="flow-drawer-section">
                <div className="flow-drawer-section-title">分支优先级（按顺序匹配，默认分支固定最后）</div>
                <Space>
                  <Button
                    size="small"
                    icon={<ArrowUp size={13} />}
                    disabled={selectedBranchCtx.index === 0}
                    onClick={() =>
                      handleReorderBranch(
                        selectedBranchCtx.nodeId,
                        selectedBranchCtx.index,
                        selectedBranchCtx.index - 1,
                      )
                    }
                  >
                    上移
                  </Button>
                  <Button
                    size="small"
                    icon={<ArrowDown size={13} />}
                    disabled={
                      selectedBranchCtx.index >= selectedBranchCtx.branches.length - 1 ||
                      (selectedBranchCtx.branches[selectedBranchCtx.index + 1]?.isDefault ?? false)
                    }
                    onClick={() =>
                      handleReorderBranch(
                        selectedBranchCtx.nodeId,
                        selectedBranchCtx.index,
                        selectedBranchCtx.index + 1,
                      )
                    }
                  >
                    下移
                  </Button>
                </Space>
              </div>
            )}
            {!selectedBranch.isDefault ? (
              <div className="flow-drawer-section">
                <div className="flow-drawer-section-title">触发条件（多个条件为「且」关系）</div>
                {!boundForm && (
                  <div className="flow-form-tip" style={{ marginBottom: 8 }}>
                    先在上方关联表单后可选择表单字段
                  </div>
                )}
                {selectedBranch.conditions.map((cond, ci) => (
                  <div key={cond.id} className="flow-condition-row">
                    <Select
                      size="small"
                      style={{ flex: 1 }}
                      value={cond.field}
                      onChange={(v) => {
                        const conditions = selectedBranch.conditions.map((c) =>
                          c.id === cond.id ? { ...c, field: v } : c,
                        )
                        setNodes((p) => updateBranch(p, selectedBranch.id, { conditions }))
                      }}
                      options={conditionFieldOptions}
                    />
                    <Select
                      size="small"
                      style={{ width: 64 }}
                      value={cond.op}
                      onChange={(v) => {
                        const conditions = selectedBranch.conditions.map((c) =>
                          c.id === cond.id ? { ...c, op: v } : c,
                        )
                        setNodes((p) => updateBranch(p, selectedBranch.id, { conditions }))
                      }}
                      options={CONDITION_OPS.map((o) => ({ label: o, value: o }))}
                    />
                    <Input
                      size="small"
                      style={{ width: 90 }}
                      placeholder="值"
                      value={cond.value}
                      onChange={(e) => {
                        const conditions = selectedBranch.conditions.map((c) =>
                          c.id === cond.id ? { ...c, value: e.target.value } : c,
                        )
                        setNodes((p) => updateBranch(p, selectedBranch.id, { conditions }))
                      }}
                    />
                    {selectedBranch.conditions.length > 1 && (
                      <Trash2
                        size={14}
                        className="flow-cond-delete"
                        onClick={() => {
                          const conditions = selectedBranch.conditions.filter((_, i) => i !== ci)
                          setNodes((p) => updateBranch(p, selectedBranch.id, { conditions }))
                        }}
                      />
                    )}
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  block
                  icon={<Plus size={13} />}
                  onClick={() =>
                    setNodes((p) =>
                      updateBranch(p, selectedBranch.id, {
                        conditions: [...selectedBranch.conditions, createCondition()],
                      }),
                    )
                  }
                >
                  添加条件
                </Button>
              </div>
            ) : (
              <div className="flow-drawer-section">
                <div className="flow-default-branch-tip">
                  默认分支：不满足其他任何分支条件时进入此分支
                </div>
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* JSON 预览 */}
      <Modal
        open={jsonOpen}
        title="流程定义 JSON"
        footer={null}
        width={640}
        onCancel={() => setJsonOpen(false)}
      >
        <pre className="flow-json-preview">{flowJson}</pre>
      </Modal>
    </div>
  )
}
