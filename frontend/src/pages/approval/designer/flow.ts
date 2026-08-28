/**
 * 审批流程领域模型（卡片式流程设计器 / 审批中心进度共用）。
 * 数据结构对齐后端 /system/flows 的 flowJson：树形节点数组。
 */

/** 节点类型：审批人 / 抄送人 / 条件分支 */
export type NodeType = 'approver' | 'cc' | 'condition'

export interface Condition {
  id: string
  field: string
  op: string
  value: string
}

export interface Branch {
  id: string
  name: string
  /** 是否默认分支（其他条件），固定在最后且不可删 */
  isDefault: boolean
  conditions: Condition[]
  children: FlowNode[]
}

export interface FlowNode {
  id: string
  type: NodeType
  name: string
  // approver
  approverType?: 'member' | 'role' | 'deptLeader'
  approvers?: string[]
  signMode?: 'or' | 'all'
  /** 是否允许审批人加签（前加签/后加签），缺省 true=允许 */
  allowAddSign?: boolean
  /** 字段级审批权限：key=表单字段编码。未出现在 map 里的字段=只读；空/undefined=全部只读 */
  fieldPerms?: Record<string, 'editable' | 'hidden'>
  // cc
  ccUsers?: string[]
  // condition
  branches?: Branch[]
}

export const MEMBERS = ['张三', '李四', '系统管理员']
export const ROLES = ['平台超管', '部门负责人', '普通员工']
export const CONDITION_FIELDS = ['days', 'leaveType', '金额(元)']
export const CONDITION_OPS = ['<', '≤', '>', '≥', '=', '≠']

let seq = 0
export function uid(): string {
  return `n_${Date.now().toString(36)}_${seq++}`
}

export function createCondition(): Condition {
  return { id: uid(), field: CONDITION_FIELDS[0], op: '<', value: '' }
}

export function createBranch(name: string, isDefault = false): Branch {
  return {
    id: uid(),
    name,
    isDefault,
    conditions: isDefault ? [] : [createCondition()],
    children: [],
  }
}

export function createNode(type: NodeType): FlowNode {
  if (type === 'approver') {
    return { id: uid(), type, name: '审批人', approverType: 'member', approvers: [], signMode: 'or' }
  }
  if (type === 'cc') {
    return { id: uid(), type, name: '抄送人', ccUsers: [] }
  }
  return {
    id: uid(),
    type: 'condition',
    name: '条件分支',
    branches: [createBranch('条件 1'), createBranch('其他条件', true)],
  }
}

/** 分支摘要文案 */
export function branchSummary(branch: Branch): string {
  if (branch.isDefault) return '其他条件进入此分支'
  if (!branch.conditions.length) return '请设置条件'
  return branch.conditions.map((c) => `${c.field} ${c.op} ${c.value || '?'}`).join(' 且 ')
}

/** 角色编码 → 中文名（种子流程里存的是角色编码如 DEPT_LEADER） */
export const ROLE_DISPLAY: Record<string, string> = {
  ADMIN: '平台超管',
  DEPT_LEADER: '部门负责人',
  EMPLOYEE: '普通员工',
}

/** 节点卡片摘要（设计器展示用）：角色编码转中文、区分审批人类型 */
export function displayApprover(node: FlowNode): string {
  if (node.type === 'approver') {
    if (node.approverType === 'deptLeader') return '部门负责人'
    if (!node.approvers?.length) return '未设置审批人'
    const names = node.approvers.map((a) => ROLE_DISPLAY[a] ?? a)
    return node.approverType === 'role' ? `角色：${names.join('、')}` : names.join('、')
  }
  if (node.type === 'cc') {
    return node.ccUsers?.length ? node.ccUsers.join('、') : '未设置抄送人'
  }
  return `${node.branches?.length || 0} 个分支`
}

/** 节点摘要文案 */
export function nodeSummary(node: FlowNode): string {
  if (node.type === 'approver') {
    const names = node.approvers?.length ? node.approvers.join('、') : '未设置审批人'
    const typeLabel =
      node.approverType === 'role' ? '角色' : node.approverType === 'deptLeader' ? '部门负责人' : ''
    return typeLabel ? `${typeLabel}：${names}` : names
  }
  if (node.type === 'cc') {
    return node.ccUsers?.length ? node.ccUsers.join('、') : '未设置抄送人'
  }
  return `${node.branches?.length || 0} 个分支`
}

/** 审批人 / 抄送人节点是否未配置完整 */
export function isNodeIncomplete(node: FlowNode): boolean {
  if (node.type === 'approver') return !node.approvers?.length && node.approverType !== 'deptLeader'
  if (node.type === 'cc') return !node.ccUsers?.length
  return false
}

/**
 * 载入的流程树补全 id：后端存量数据（如种子流程）的节点/分支/条件可能没有 id，
 * 而分支内插入节点依赖分支 id 作为容器定位——缺 id 会回退到 ROOT_LIST，导致节点插到主链。
 */
export function ensureIds(nodes: FlowNode[]): FlowNode[] {
  const walk = (list: FlowNode[]) => {
    list.forEach((n) => {
      if (!n.id) n.id = uid()
      n.branches?.forEach((b) => {
        if (!b.id) b.id = uid()
        b.conditions?.forEach((c) => {
          if (!c.id) c.id = uid()
        })
        walk(b.children)
      })
    })
  }
  walk(nodes)
  return nodes
}

/** 分支是否未配置完整 */
export function isBranchIncomplete(branch: Branch): boolean {
  return !branch.isDefault && branch.conditions.some((c) => !c.value)
}

/** 统计整棵树未配置完整的节点数 */
export function countIncomplete(nodes: FlowNode[]): number {
  let count = 0
  const walk = (list: FlowNode[]) => {
    list.forEach((n) => {
      if (isNodeIncomplete(n)) count++
      n.branches?.forEach((b) => {
        if (isBranchIncomplete(b)) count++
        walk(b.children)
      })
    })
  }
  walk(nodes)
  return count
}

/* ---------------- 树形数据的不可变更新 helpers ---------------- */

/** 顶层链的容器 id */
export const ROOT_LIST = 'root'

function cloneNodes(nodes: FlowNode[]): FlowNode[] {
  return JSON.parse(JSON.stringify(nodes)) as FlowNode[]
}

/** 按容器 id 找到节点列表：'root' 为顶层，否则为某个分支的 children */
function findList(nodes: FlowNode[], containerId: string): FlowNode[] | null {
  if (containerId === ROOT_LIST) return nodes
  for (const n of nodes) {
    for (const b of n.branches ?? []) {
      if (b.id === containerId) return b.children
      const found = findList(b.children, containerId)
      if (found) return found
    }
  }
  return null
}

/** 按 id 查找节点（只读） */
export function getNode(nodes: FlowNode[], id: string): FlowNode | null {
  return findNode(nodes, id)
}

/**
 * 按索引路径（如 "0"、"1/0/0"）查找节点：与后端审批引擎 expand/walkNode 的
 * nodeId 编码一致——普通节点消费 1 段；condition 之后一段为分支索引，再进入其 children。
 * 任务/进度里的 nodeId 都是这种索引路径（前端节点 uid 仅设计器内部定位用，不入库）。
 */
export function getNodeByPath(nodes: FlowNode[], path: string): FlowNode | null {
  const segs = path.split('/')
  let list = nodes
  let i = 0
  while (i < segs.length) {
    const idx = Number(segs[i])
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return null
    const node = list[idx]
    if (i === segs.length - 1) return node
    if (node.type !== 'condition' || i + 1 >= segs.length) return null
    const branch = node.branches?.[Number(segs[i + 1])]
    if (!branch) return null
    list = branch.children
    i += 2
  }
  return null
}

/** 按 id 查找分支（只读） */
export function getBranch(nodes: FlowNode[], branchId: string): Branch | null {
  return findBranch(nodes, branchId)
}

function findNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    for (const b of n.branches ?? []) {
      const found = findNode(b.children, id)
      if (found) return found
    }
  }
  return null
}

function findBranch(nodes: FlowNode[], branchId: string): Branch | null {
  for (const n of nodes) {
    for (const b of n.branches ?? []) {
      if (b.id === branchId) return b
      const found = findBranch(b.children, branchId)
      if (found) return found
    }
  }
  return null
}

/** 对整棵树执行一次「克隆 + 原地修改」，返回新树 */
export function mutateNodes(nodes: FlowNode[], fn: (draft: FlowNode[]) => void): FlowNode[] {
  const draft = cloneNodes(nodes)
  fn(draft)
  return draft
}

export function insertNodeAt(
  nodes: FlowNode[],
  containerId: string,
  index: number,
  type: NodeType,
): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    findList(draft, containerId)?.splice(index, 0, createNode(type))
  })
}

export function removeNodeAt(nodes: FlowNode[], containerId: string, index: number): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    findList(draft, containerId)?.splice(index, 1)
  })
}

export function updateNode(nodes: FlowNode[], id: string, patch: Partial<FlowNode>): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    const target = findNode(draft, id)
    if (target) Object.assign(target, patch)
  })
}

export function addBranchTo(nodes: FlowNode[], nodeId: string): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    const node = findNode(draft, nodeId)
    if (!node?.branches) return
    const normalCount = node.branches.filter((b) => !b.isDefault).length
    const branch = createBranch(`条件 ${normalCount + 1}`)
    const defaultIdx = node.branches.findIndex((b) => b.isDefault)
    // 默认分支始终保持在最后
    if (defaultIdx >= 0) node.branches.splice(defaultIdx, 0, branch)
    else node.branches.push(branch)
  })
}

export function removeBranchAt(nodes: FlowNode[], nodeId: string, index: number): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    const node = findNode(draft, nodeId)
    if (!node?.branches || node.branches.length <= 2) return
    node.branches.splice(index, 1)
  })
}

export function updateBranch(nodes: FlowNode[], branchId: string, patch: Partial<Branch>): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    const target = findBranch(draft, branchId)
    if (target) Object.assign(target, patch)
  })
}

/**
 * 重排条件分支（from/to 语义：先删除 fromIndex 元素，再插入到 toIndex 位置）。
 * 默认分支（其他条件）固定最后：不可拖，插入位置也被钳制到默认分支之前。
 */
export function reorderBranches(
  nodes: FlowNode[],
  nodeId: string,
  fromIndex: number,
  toIndex: number,
): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    const node = findNode(draft, nodeId)
    const branches = node?.branches
    if (!branches) return
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= branches.length) return
    if (branches[fromIndex].isDefault) return
    const [moved] = branches.splice(fromIndex, 1)
    const defaultIdx = branches.findIndex((b) => b.isDefault)
    const max = defaultIdx >= 0 ? defaultIdx : branches.length
    branches.splice(Math.min(Math.max(toIndex, 0), max), 0, moved)
  })
}

/**
 * 同容器内重排节点（from/to 语义同上：先删后插）。
 * containerId 为 'root'（主链）或分支 id；v1 不支持跨容器移动。
 */
export function reorderNodes(
  nodes: FlowNode[],
  containerId: string,
  fromIndex: number,
  toIndex: number,
): FlowNode[] {
  return mutateNodes(nodes, (draft) => {
    const list = findList(draft, containerId)
    if (!list) return
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= list.length) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(Math.min(Math.max(toIndex, 0), list.length), 0, moved)
  })
}
