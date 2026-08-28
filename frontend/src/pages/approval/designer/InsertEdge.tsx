/**
 * React Flow 自定义边：smoothstep 连线 + 中点「+」插入按钮。
 * 点击 + 弹出菜单（审批人/抄送人/条件分支），按边携带的 { containerId, index } 插入：
 * 主链边插主链、分支内边插分支、condition→分支卡 / 分支末→merge 锚点的边分别插到分支首/尾；
 * merge→主链的边插到 condition 之后的主链位置。
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { Dropdown } from 'antd'
import { GitBranch, Plus, Send, User } from 'lucide-react'
import type { NodeType } from './flow'
import type { InsertEdgeData } from './layout'

export default function InsertEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<InsertEdgeData>>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  })
  if (!data) return <BaseEdge id={id} path={path} />
  const { containerId, index, onInsert } = data
  return (
    <>
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        <div
          className="flow-edge-label nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <Dropdown
            menu={{
              items: [
                { key: 'approver', icon: <User size={14} />, label: '审批人' },
                { key: 'cc', icon: <Send size={14} />, label: '抄送人' },
                { key: 'condition', icon: <GitBranch size={14} />, label: '条件分支' },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation()
                onInsert(containerId, index, key as NodeType)
              },
            }}
            trigger={['click']}
            placement="bottom"
          >
            <button type="button" className="flow-add-btn" title="插入节点">
              <Plus size={12} />
            </button>
          </Dropdown>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const flowEdgeTypes = { insert: InsertEdge }
