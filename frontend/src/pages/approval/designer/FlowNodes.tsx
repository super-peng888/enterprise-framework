/**
 * React Flow 自定义节点：视觉沿用原手写卡片语言（designer.css 的 flow-card 系列样式）。
 * - start：发起人（渐变图标端点卡）；end：流程结束 pill
 * - approver / cc：节点卡（图标+名称+或签/会签 tag+摘要+! 角标+× 删除）
 * - condition：条件分支锚点小节点（琥珀 pill，点击打开分支管理抽屉；「+」添加分支，hover 显示 × 删除整个条件节点）
 * - merge：汇合锚点（与 condition 同风格的小 pill，仅作汇合点，不可点击/删除）
 * - branch：分支卡（琥珀顶条：优先级+名称+条件 chips+! 角标+× 删除）
 * 节点均不可拖动（布局由 layout.ts 计算），点击卡片打开右侧配置抽屉。
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { CheckCircle, GitBranch, PlayCircle, Plus, Send, User, X } from 'lucide-react'
import { displayApprover } from './flow'
import type { BranchData, CardData, ConditionData } from './layout'

const NODE_META = {
  approver: { color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  cc: { color: 'var(--color-success)', bg: 'var(--success-light)' },
} as const

export function StartNode() {
  return (
    <>
      <div className="flow-card flow-endpoint-card">
        <div className="flow-endpoint-icon">
          <PlayCircle size={16} />
        </div>
        <div>
          <div className="flow-card-name">发起人</div>
          <div className="flow-card-desc">全体成员</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

export function EndNode() {
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div className="flow-end">
        <CheckCircle size={14} />
        <span>流程结束</span>
      </div>
    </>
  )
}

export function CardNode({ data }: NodeProps<Node<CardData, 'approver' | 'cc'>>) {
  const { node, selected, incomplete, onSelect, onRemove } = data
  const meta = NODE_META[node.type as 'approver' | 'cc'] ?? NODE_META.approver
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        className={[
          'flow-card',
          'flow-node-card',
          selected ? 'is-selected' : '',
          incomplete ? 'is-incomplete' : '',
        ].join(' ')}
        onClick={onSelect}
      >
        <div className="flow-card-header">
          <div className="flow-card-title">
            <span className="flow-node-icon" style={{ background: meta.bg, color: meta.color }}>
              {node.type === 'approver' ? <User size={13} /> : <Send size={13} />}
            </span>
            <span className="flow-card-name">{node.name}</span>
            {node.type === 'approver' &&
              ((node.approvers?.length ?? 0) > 1 || node.approverType === 'role') && (
                <span className="flow-sign-tag">{node.signMode === 'all' ? '会签' : '或签'}</span>
              )}
          </div>
          <X
            size={14}
            className="flow-card-close"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          />
        </div>
        <div className={`flow-card-desc ${incomplete ? 'is-empty' : ''}`}>
          {displayApprover(node)}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

/** 条件分支锚点：琥珀 pill，点击打开分支管理抽屉；「+」添加分支，hover 显示 × 删除整个条件节点 */
export function ConditionNode({ data }: NodeProps<Node<ConditionData, 'condition'>>) {
  const { node, selected, onSelect, onRemove, onAddBranch } = data
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        className={['flow-cond-anchor', selected ? 'is-selected' : ''].join(' ')}
        title={`${node.name}（${node.branches?.length ?? 0} 个分支，点击管理）`}
        onClick={onSelect}
      >
        <GitBranch size={13} />
        <span className="flow-cond-anchor-name">{node.name}</span>
        <Plus
          size={12}
          className="flow-cond-anchor-add"
          onClick={(e) => {
            e.stopPropagation()
            onAddBranch()
          }}
        />
        <X
          size={12}
          className="flow-card-close flow-cond-anchor-close"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        />
      </div>
      {/* 分叉端单点出发：smoothstep 自动形成「向下→横向总线→落各分支」的总线效果 */}
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

/** 汇合总线：不是节点，仅一根横向总线——各分支落线汇于此，中心单线向下 */
export function MergeNode({ data }: NodeProps<Node<{ inlets?: number[] }, 'merge'>>) {
  const inlets = data?.inlets
  return (
    <>
      {/* 每个分支一个入桩（对齐各自分支列中心），落线汇到总线上 */}
      {inlets?.length ? (
        inlets.map((x, i) => (
          <Handle key={i} id={`in-${i}`} type="target" position={Position.Top} style={{ left: x }} />
        ))
      ) : (
        <Handle type="target" position={Position.Top} />
      )}
      <div className="flow-merge-bus" />
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

export function BranchNode({ data }: NodeProps<Node<BranchData, 'branch'>>) {
  const { branch, priority, selected, incomplete, removable, onSelect, onRemove } = data
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        className={[
          'flow-card',
          'flow-branch-card',
          selected ? 'is-selected' : '',
          incomplete ? 'is-incomplete' : '',
        ].join(' ')}
        onClick={onSelect}
      >
        <div className="flow-card-header">
          <div className="flow-card-title">
            <span className={`flow-branch-priority ${branch.isDefault ? 'is-default' : ''}`}>
              {priority}
            </span>
            <span className="flow-card-name">{branch.name}</span>
          </div>
          {removable && (
            <X
              size={14}
              className="flow-card-close"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
            />
          )}
        </div>
        {branch.isDefault ? (
          <div className="flow-card-desc">其他条件进入此分支</div>
        ) : branch.conditions.length === 0 ? (
          <div className="flow-card-desc is-empty">请设置条件</div>
        ) : (
          <div className="flow-cond-chips">
            {branch.conditions.map((c) => (
              <span key={c.id} className={`flow-cond-chip ${!c.value ? 'is-empty' : ''}`}>
                {c.field} {c.op} {c.value || '?'}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

export const flowNodeTypes = {
  start: StartNode,
  end: EndNode,
  approver: CardNode,
  cc: CardNode,
  condition: ConditionNode,
  merge: MergeNode,
  branch: BranchNode,
}
