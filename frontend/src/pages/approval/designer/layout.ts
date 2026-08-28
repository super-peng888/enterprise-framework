/**
 * 树形流程数据 → React Flow nodes/edges 的纯布局计算（不依赖 React）。
 *
 * 布局规则：
 * - 主链垂直排列、水平居中于 x=0：发起人(start)在顶、流程结束(end)在底，y 按节点高度 + 边距累加；
 * - condition 节点本身是一个小锚点（分叉点），其分支横向排开：每分支一列，
 *   列首为分支卡片（branch），列内子链垂直向下（递归布局嵌套的 condition），
 *   列宽取「分支卡宽」与「子链最大宽」的较大值；分支行下方居中放一个 merge 汇合锚点
 *   （x = 首/末分支中心的中点），与 condition 分叉锚点对称；
 * - 连线：主链相邻节点依次连边；condition 锚点 → 各分支卡（+ = 插入为该分支第一个节点）；
 *   分支末节点（空分支则为分支卡）→ 本条件的 merge 锚点（+ = 插入为该分支最后节点）；
 *   merge → condition 之后的主链节点（仅一条汇合边，+ = 插入到 condition 之后的主链位置）。
 * - 添加分支：condition 锚点节点上的「+」按钮 / 条件节点抽屉内操作，不再有独立按钮节点。
 *
 * 每条边都携带插入语义 data { containerId, index }：点击边中点「+」按该位置插入节点。
 * 节点不可拖动，坐标完全由本模块计算，结构变更后重新布局即可。
 */
import type { Edge, Node } from '@xyflow/react'
import {
  isBranchIncomplete,
  isNodeIncomplete,
  ROOT_LIST,
  type Branch,
  type FlowNode,
  type NodeType,
} from './flow'

/* ---------------- 尺寸常量（与 designer.css 卡片样式匹配，略高估防重叠） ---------------- */

export const CARD_W = 240 // 审批人/抄送人/分支卡片宽
const CARD_H = 92 // 审批人/抄送人卡片高（图标+名称+摘要）
const START_H = 58
const END_W = 132
const END_H = 34
const COND_W = 200 // 条件分支锚点（加宽容纳「+」添加分支按钮）
const COND_H = 32
const MERGE_PAD = 0 // 汇合总线宽度 = 首末分支列中心距（与分叉总线等宽，拐角正好接到端点）
const MERGE_H = 10
const EDGE_GAP = 56 // 垂直边长（中点要放 + 按钮）
const COL_GAP = 48 // 分支列间距

/** 分支卡片高：无条件/默认分支一行摘要；有条件时按 chips 行数（约每行 2 个）估算 */
function branchCardH(b: Branch): number {
  if (b.isDefault || b.conditions.length === 0) return 78
  const rows = Math.ceil(b.conditions.length / 2)
  return 54 + rows * 28
}

/* ---------------- 对外类型 ---------------- */

export interface LayoutHandlers {
  onSelectNode: (id: string) => void
  onSelectBranch: (id: string) => void
  onRemoveNode: (containerId: string, index: number) => void
  onRemoveBranch: (nodeId: string, index: number) => void
  onAddBranch: (nodeId: string) => void
  onInsert: (containerId: string, index: number, type: NodeType) => void
}

export interface CardData extends Record<string, unknown> {
  node: FlowNode
  selected: boolean
  incomplete: boolean
  onSelect: () => void
  onRemove: () => void
}

export interface ConditionData extends Record<string, unknown> {
  node: FlowNode
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onAddBranch: () => void
  /** 各分支源连接桩的 x 偏移（相对节点左缘，对齐分支列中心），分叉线各自独立 */
  outlets?: number[]
}

export interface BranchData extends Record<string, unknown> {
  branch: Branch
  /** 优先级标签：条件 1 / 条件 2 / 默认 */
  priority: string
  selected: boolean
  incomplete: boolean
  removable: boolean
  onSelect: () => void
  onRemove: () => void
}

export interface InsertEdgeData extends Record<string, unknown> {
  containerId: string
  index: number
  onInsert: (containerId: string, index: number, type: NodeType) => void
}

export type FlowRFNode =
  | Node<Record<string, unknown>, 'start' | 'end' | 'merge'>
  | Node<CardData, 'approver' | 'cc'>
  | Node<ConditionData, 'condition'>
  | Node<BranchData, 'branch'>

export type FlowRFEdge = Edge<InsertEdgeData>

/* ---------------- 度量（子树包围盒） ---------------- */

interface Box {
  w: number
  h: number
}

function measureNode(n: FlowNode): Box {
  if (n.type !== 'condition') return { w: CARD_W, h: CARD_H }
  const branches = n.branches ?? []
  let colsW = 0
  let maxColH = 0
  branches.forEach((b) => {
    colsW += Math.max(CARD_W, chainBox(b.children).w)
    const childH = b.children.length ? chainBox(b.children).h : 0
    maxColH = Math.max(maxColH, branchCardH(b) + (childH ? EDGE_GAP + childH : 0))
  })
  return {
    w: colsW + COL_GAP * Math.max(branches.length - 1, 0),
    h: COND_H + EDGE_GAP + maxColH + EDGE_GAP + MERGE_H, // 分支行下方还有汇合锚点
  }
}

function chainBox(list: FlowNode[]): Box {
  let w = 0
  let h = 0
  list.forEach((n, i) => {
    const b = measureNode(n)
    w = Math.max(w, b.w)
    h += b.h + (i > 0 ? EDGE_GAP : 0)
  })
  return { w, h }
}

/* ---------------- 摆放 ---------------- */

/** 等待连向后继的输出端：source 节点 id + 该边的插入语义 */
interface Sink {
  id: string
  containerId: string
  index: number
}

interface Out {
  nodes: FlowRFNode[]
  edges: FlowRFEdge[]
}

interface Ctx extends LayoutHandlers {
  selectedId: string | null | undefined
}

function pushEdge(out: Out, from: Sink, targetId: string, ctx: Ctx, handles?: { sourceHandle?: string; targetHandle?: string }) {
  out.edges.push({
    id: `e${out.edges.length}_${from.id}_${targetId}`,
    source: from.id,
    target: targetId,
    type: 'insert',
    sourceHandle: handles?.sourceHandle,
    targetHandle: handles?.targetHandle,
    data: { containerId: from.containerId, index: from.index, onInsert: ctx.onInsert },
  })
}

/** 摆放条件分支节点：锚点 + 分支列（递归子链）+ 汇合锚点；返回块高 */
function placeCondition(
  n: FlowNode,
  cx: number,
  y: number,
  succId: string | null,
  containerId: string,
  index: number,
  out: Out,
  ctx: Ctx,
): number {
  const branches = n.branches ?? []
  const mergeId = `merge_${n.id}`
  const condData: ConditionData = {
    node: n,
    selected: ctx.selectedId === n.id,
    onSelect: () => ctx.onSelectNode(n.id),
    onRemove: () => ctx.onRemoveNode(containerId, index),
    onAddBranch: () => ctx.onAddBranch(n.id),
  }
  out.nodes.push({
    id: n.id,
    type: 'condition',
    position: { x: cx - COND_W / 2, y },
    width: COND_W,
    height: COND_H,
    data: condData,
  })

  const colWs = branches.map((b) => Math.max(CARD_W, chainBox(b.children).w))
  const totalW = colWs.reduce((a, c) => a + c, 0) + COL_GAP * Math.max(branches.length - 1, 0)
  const branchY = y + COND_H + EDGE_GAP

  let x = cx - totalW / 2
  let maxColH = 0
  let firstColCx = cx
  let lastColCx = cx
  const colCxs: number[] = []
  branches.forEach((b, bi) => {
    const colCx = x + colWs[bi] / 2
    colCxs.push(colCx)
    x += colWs[bi] + COL_GAP
    if (bi === 0) firstColCx = colCx
    lastColCx = colCx
    const bh = branchCardH(b)
    const normalIndex = branches.filter((bb) => !bb.isDefault).indexOf(b) + 1
    out.nodes.push({
      id: b.id,
      type: 'branch',
      position: { x: colCx - CARD_W / 2, y: branchY },
      width: CARD_W,
      height: bh,
      data: {
        branch: b,
        priority: b.isDefault ? '默认' : `条件 ${normalIndex}`,
        selected: ctx.selectedId === b.id,
        incomplete: isBranchIncomplete(b),
        removable: branches.length > 2 && !b.isDefault,
        onSelect: () => ctx.onSelectBranch(b.id),
        onRemove: () => ctx.onRemoveBranch(n.id, bi),
      },
    })
    // 锚点 → 分支卡：单源点出发，smoothstep 自动形成总线；+ = 插入为该分支第一个节点
    pushEdge(out, { id: n.id, containerId: b.id, index: 0 }, b.id, ctx)
    // 分支内子链（递归），末端连向本条件的 merge 锚点（走该分支自己的入桩）；空分支时 placeChain 直接连 分支卡 → merge
    const childH = placeChain(
      b.children,
      colCx,
      branchY + bh + (b.children.length ? EDGE_GAP : 0),
      { id: b.id, containerId: b.id, index: 0 },
      mergeId,
      b.id,
      out,
      ctx,
      `in-${bi}`,
    )
    maxColH = Math.max(maxColH, bh + (childH ? EDGE_GAP + childH : 0))
  })

  // merge 汇合锚点：横向汇合条，宽度覆盖首末分支列（各分支回程线都落在条体上，不悬空）
  const mergeY = y + COND_H + EDGE_GAP + maxColH + EDGE_GAP
  const mergeX = firstColCx - MERGE_PAD
  const mergeW = lastColCx - firstColCx + MERGE_PAD * 2
  out.nodes.push({
    id: mergeId,
    type: 'merge',
    position: { x: mergeX, y: mergeY },
    width: mergeW,
    height: MERGE_H,
    data: {
      // 各分支入桩的 x 偏移（相对汇合条左缘，对齐各自分支列中心）
      inlets: colCxs.map((c) => c - mergeX),
    },
  })
  // merge → condition 之后的主链节点：唯一汇合边，+ = 插入到 condition 之后的主链位置
  if (succId) pushEdge(out, { id: mergeId, containerId, index: index + 1 }, succId, ctx)

  return COND_H + EDGE_GAP + maxColH + EDGE_GAP + MERGE_H
}

/** 摆放一条节点链（主链或分支子链）；endTargetHandle 为链末端连向 nextId 时使用的目标连接桩；返回链高 */
function placeChain(
  list: FlowNode[],
  cx: number,
  y: number,
  from: Sink | null,
  nextId: string | null,
  containerId: string,
  out: Out,
  ctx: Ctx,
  endTargetHandle?: string,
): number {
  if (!list.length) {
    if (from && nextId) pushEdge(out, from, nextId, ctx, { targetHandle: endTargetHandle })
    return 0
  }
  let cy = y
  let pending: Sink | null = from
  list.forEach((n, i) => {
    const succId = i < list.length - 1 ? list[i + 1].id : nextId
    if (pending) pushEdge(out, pending, n.id, ctx)
    if (n.type === 'condition') {
      cy += placeCondition(n, cx, cy, succId, containerId, i, out, ctx)
      pending = null // condition 的后继由其 merge 锚点的汇合边连接
    } else {
      out.nodes.push({
        id: n.id,
        type: n.type,
        position: { x: cx - CARD_W / 2, y: cy },
        width: CARD_W,
        height: CARD_H,
        data: {
          node: n,
          selected: ctx.selectedId === n.id,
          incomplete: isNodeIncomplete(n),
          onSelect: () => ctx.onSelectNode(n.id),
          onRemove: () => ctx.onRemoveNode(containerId, i),
        },
      })
      cy += CARD_H
      pending = { id: n.id, containerId, index: i + 1 }
    }
    if (i < list.length - 1) cy += EDGE_GAP
  })
  if (nextId && pending) pushEdge(out, pending, nextId, ctx, { targetHandle: endTargetHandle })
  return cy - y
}

/** 整树布局入口：返回 React Flow 的 nodes/edges */
export function layoutFlow(
  flowNodes: FlowNode[],
  selectedId: string | null | undefined,
  handlers: LayoutHandlers,
): { nodes: FlowRFNode[]; edges: FlowRFEdge[] } {
  const out: Out = { nodes: [], edges: [] }
  const ctx: Ctx = { ...handlers, selectedId }

  out.nodes.push({
    id: 'start',
    type: 'start',
    position: { x: -CARD_W / 2, y: 0 },
    width: CARD_W,
    height: START_H,
    data: {},
  })

  const chainH = placeChain(
    flowNodes,
    0,
    START_H + EDGE_GAP,
    { id: 'start', containerId: ROOT_LIST, index: 0 },
    'end',
    ROOT_LIST,
    out,
    ctx,
  )

  out.nodes.push({
    id: 'end',
    type: 'end',
    position: { x: -END_W / 2, y: START_H + EDGE_GAP + chainH + EDGE_GAP },
    width: END_W,
    height: END_H,
    data: {},
  })

  return out
}
