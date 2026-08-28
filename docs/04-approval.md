# 04 审批体系：表单中心 / 流程设计器 / 引擎 / 审批中心 / 发起

> 面向接手维护者。前端在 `frontend/src/pages/approval/` 下四个目录，
> 后端在 `backend/framework-system`（包 `com.framework.system`）。
> 本文所有行为均对照源码核实，括注为关键实现位置。
>
> 路由约定：前端请求统一走 `/system/**` 前缀（网关 StripPrefix=2），后端 controller
> 实际路径不含该前缀（如前端 `GET /system/flows` → 后端 `FlowController` 的 `GET /flows`）。
> 除 `/internal/**` 外所有接口需 JWT（`SecurityConfig`：`/auth/login`、`/actuator/health`、
> `/error`、`/internal/**` 放行）。

---

## 1. 体系总览

四个核心表（DDL：`backend/framework-system/src/main/resources/schema.sql:249-336`）：

```
form_definition (表单)                approval_template (审批模板)
  id ◄────────────┐                     id, code(唯一), name
  code (全局唯一)  │ form_id              form_id ──► form_definition
  name            │                     flow_id ──► flow_definition
  schema (jsonb)  │                     status
  status          │
                  │                ┌────────┘ code = "FLOW_{flowId}"
                  │                │ （保存流程时自动同步，见 1.2）
flow_definition (流程)              │
  id ──────────────────────────────┘
  name
  flow_json (jsonb, 树形节点数组)
  form_id ──► form_definition
  status

approval_template 1 ── N approval_instance (实例)
  id, template_id, title, business_key, form_data (jsonb),
  flow_snapshot (jsonb, 发起时冻结的流程快照),
  status, current_node_path, initiator_id/name, created_at, finished_at

approval_instance 1 ── N approval_task (任务)
  id, instance_id, node_id(索引路径如 "1/0/0"), node_name, node_type(approver/cc),
  assignee_name(realName), sign_mode(or/all), status, origin(NORMAL/ADD_BEFORE/ADD_AFTER),
  parent_task_id, comment, acted_at, sort
```

关系一句话：**表单定义字段，流程定义审批路径并引用表单（`flow_definition.form_id`），
模板是「表单 + 流程」的可发起组合，实例按模板发起并快照流程，任务是实例推进过程中
落到人头上的待办/记录。**

实体：`entity/FormDefinition.java`、`FlowDefinition.java`、`ApprovalTemplate.java`、
`ApprovalInstance.java`、`ApprovalTask.java`。

### 1.1 flowJson 结构

`flow_definition.flow_json` 为树形节点数组（schema.sql:264-267 注释 + 前端
`src/pages/approval/designer/flow.ts` 对齐）：

```jsonc
{
  "nodes": [
    { "type": "approver", "name": "总监审批",
      "approverType": "member | role | deptLeader",
      "approvers": ["张三"], "signMode": "or | all", "allowAddSign": true },
    { "type": "cc", "name": "抄送人事", "ccUsers": ["李四"] },
    { "type": "condition", "name": "按天数分支",
      "branches": [
        { "name": "大于3天", "isDefault": false,
          "conditions": [{ "field": "days", "op": ">", "value": "3" }],
          "children": [ /* 递归 FlowNode[] */ ] },
        { "name": "其他条件", "isDefault": true, "conditions": [], "children": [] }
      ] }
  ]
}
```

### 1.2 保存流程自动同步模板

`FlowController.syncTemplate(FlowDefinition)`（`controller/FlowController.java:41-56`）：
`POST /flows` 与 `PUT /flows/{id}` 保存后调用。若 `flow.formId != null`，按
`code = "FLOW_" + flow.getId()` upsert 一条 `approval_template`（name 同步流程名，
formId/flowId 同步；新建时 status 缺省「启用」，已有模板保留原 status）。
未关联表单的流程**不会**生成模板（前端设计器工具栏有对应警告徽章），也就不能被发起。

---

## 2. 表单中心

页面：`frontend/src/pages/approval/forms/FormCenter.tsx`（列表）+
`FormDesigner.tsx`（设计器，1051 行，由列表页内部切换进入，非独立路由）。
路由：`/approval/forms`。渲染器：全局组件 `SchemaForm`（详见 `docs/03-components.md` 第 3 节）。

### 2.1 设计器三栏

```
┌──────────────── 顶部工具条 ────────────────────────────────┐
│ 返回列表 | 表单名称 | Code(只读) | 清空 | 预览 | 保存        │
├──────────┬──────────────────────────────┬─────────────────┤
│ 控件面板  │        画布（4 列栅格）        │  右侧配置面板     │
│ (PALETTE)│  点选/拖拽排序/插入指示线       │  表单/容器/字段   │
└──────────┴──────────────────────────────┴─────────────────┘
```

- **控件面板**（`PALETTE`，FormDesigner.tsx:133-162）四组：
  - 布局容器：分组（group）、块（block）
  - 辅助：占位符 placeholder、分割线 divider、标题 title、提示文本 text
  - 输入：单行文本、多行文本、数字、金额、百分比、开关、评分、滑杆
  - 选择：下拉选择、下拉选择(带搜索)、下拉多选、单选按钮、复选框、成员选择、
    日期、日期范围、附件上传
- **画布**：4 列栅格，字段 span 1-4 占列；容器内同样 4 列。点击或 HTML5 原生 DnD
  拖入；支持面板→画布/字段前后/容器内、画布内排序、跨容器移动、容器排序，
  目标位置显示插入指示线（`DropIndicator`）；**容器不可嵌套容器**
  （`model.ts:263`，`insertNode` 直接 return）。
- **右侧面板**：未选中=表单属性（名称/Code 只读/启用开关）；选中容器=仅标题；
  选中字段=`FieldConfig`（标题、编码 key、宽度、placeholder、必填、默认值、
  min/max、rows、数据源等，按类型条件显示；title 级别、text 提示内容、
  placeholder 高度 40-400）。

### 2.2 容器：group vs block

均为 `SectionNode { kind:'section', sectionType, title, children: FieldNode[] }`，
只嵌字段。区别（model.ts:84 注释 + CSS class `is-group`/`is-block`）：
group = 带标题的分区；block = 虚线边框区块，**头部多一个「复制」按钮**
（`cloneSectionNode`：深拷贝、新 id、标题加「副本」、字段 key 加 `_copy` 后缀），
group 没有复制。

### 2.3 数据源（静态选项 / 接口）

仅 select 系五类控件（select/selectSearch/multiSelect/radio/checkbox）可配
（`FieldDataSource`，model.ts:44-54）：

- **静态选项**：options 行编辑（label/value + 上移/下移/删除/添加）。
- **接口获取**：接口地址 url（如 `/system/users`）、结果取值路径 resultPath
  （如 `data.list`，支持 a.b.c 点路径）、label 字段、value 字段；四项均必填
  （`dataSourceError`）。「测试获取」按钮现场请求并提示「共 N 条，前 3 条：
  label = value」；失败提示渲染端将降级为空选项。

### 2.4 code 与 key

- 表单 `code`：全局唯一（DB 唯一索引 `uk_form_definition_code`），新建时前端异步
  预检查重（`FormCenter.tsx:178-201`），创建后只读。`CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]*$/`（兼容大写存量）。
- 字段 `key`：`KEY_PATTERN = /^[a-z][a-z0-9_]*$/`（小写字母开头）+ 表单内唯一
  （跨容器全量比对，`fieldKeyError`，model.ts:303-315）；保存时逐字段校验。
- 全局引用方式：任何页面 `<SchemaForm formCode="LEAVE_APPLY" mode="edit" />`，
  内部走 `GET /system/forms/code/{code}`（只返回启用表单）。FormCenter 的预览弹窗
  演示的正是这条链路。

### 2.5 后端接口（FormController，`/forms`）

`GET /forms`、`GET /forms/{id}`、`GET /forms/code/{code}`（仅 status='启用'，否则 404）、
`POST /forms`、`PUT /forms/{id}`、`DELETE /forms/{id}`。schema 存 jsonb，后端不感知结构。

---

## 3. 流程设计器（React Flow）

页面：`frontend/src/pages/approval/designer/FlowDesigner.tsx`（783 行），
配套 `flow.ts`（领域模型+树操作）、`layout.ts`（布局算法）、`FlowNodes.tsx`（节点渲染）、
`InsertEdge.tsx`（边）。路由：`/approval/designer`。

库：`@xyflow/react` ^12.11.5。画布锁定结构：`nodesDraggable={false}
nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null}`，
缩放 0.1-1.5，结构变化后 50ms 重新 fitView；右下角 MiniMap 可收折。

### 3.1 节点类型（重要：领域节点只有三种）

`flow.ts:7`：`NodeType = 'approver' | 'cc' | 'condition'`。
**start / end / branch / merge 不是业务节点，只是 React Flow 渲染层节点类型**
（layout.ts:95-99 自动首尾补 start/end，condition 渲染为「condition 锚点 + 分支卡 +
merge 汇合条」三件套）。保存到后端的 flowJson 只有三种节点的树。

各节点配置（右侧 Drawer，宽 400）：

- **approver**：名称；审批人类型三选一——指定成员（多选，`GET /system/users`，
  存 realName）/ 指定角色（多选，`GET /system/roles`，**存角色编码**）/
  部门负责人（deptLeader，无选择器）；审批方式或签 or / 会签 all
  （`approvers.length <= 1` 时禁用切换）；允许加签开关（缺省 true）。
- **cc**：名称 + 抄送人多选（提示「流程通过后自动通知」）。
- **condition**：名称 + 分支管理列表（改名/上移下移/进分支条件配置/删除）+
  「添加分支」。

### 3.2 布局算法（layout.ts）

尺寸常量（layout.ts:30-40）：卡片 `CARD_W=240 × CARD_H=92`，start 高 58，
end `132×34`，condition 锚点 `200×32`，merge 高 10，垂直边长 `EDGE_GAP=56`
（中点放 + 按钮），分支列间距 `COL_GAP=48`。分支卡高：默认/无条件 78，
否则 `54 + ceil(条件数/2)*28`。

**主链垂直、水平居中 x=0**：start 在 y=0，主链每节点「高 + EDGE_GAP」累加
（`placeChain`），end 在链尾再隔一个 EDGE_GAP。

**分叉与汇合**（condition 的处理，layout.ts:196-262）：

```
                ┌──────────┐
                │  上一节点  │
                └────┬─────┘
                     │  insert 边（中点 +）
                ┌────▼─────┐
                │ condition │  200×32 小 pill 锚点
                └──┬───┬───┘
              ┌────┘   │   └────┐          ← condition→各分支卡（smoothstep，
        ┌─────▼──┐ ┌───▼───┐ ┌──▼──────┐      单源点自动成"分叉总线"）
        │分支卡 1 │ │分支卡 2│ │默认分支卡│      列宽 = max(240, 子链宽)，
        └─────┬──┘ └───┬───┘ └──┬──────┘      各列横排，起点 x = cx - 总宽/2
         ┌────▼───┐ ┌──▼────┐ ┌─▼──────┐
         │子链节点 │ │子链节点│ │子链节点 │      ← 列内递归 placeChain
         └────┬───┘ └──┬────┘ └──┬─────┘
              │        │         │
        ┌─────▼────────▼─────────▼─────┐
        │  merge 汇合条（高 10）         │  ← y = 锚点底 + EDGE_GAP + 最高列高 + EDGE_GAP
        │  inlets: [in-0, in-1, in-2]  │     宽 = 首末分支列中心距；
        └──────────────┬───────────────┘     data.inlets 携带各分支入桩 x 偏移，
                       │                     MergeNode 按 inlets 渲染多个 Handle
                ┌──────▼─────┐               （id="in-{i}"）
                │  下一主链节点 │  ← merge→后继仅一条汇合边
                └────────────┘
```

- 分支末节点 → merge 的 `in-{分支序号}` 桩各连一条边；merge → 后继主链节点一条边。
- 条件节点可嵌套（分支 children 递归布局）。

### 3.3 边中点 + 插入（InsertEdge.tsx）

每条边 `type: 'insert'`，用 `getSmoothStepPath(borderRadius: 8)` 画线，
`EdgeLabelRenderer` 在中点放圆形 `.flow-add-btn`（含 `nodrag nopan`）；点击弹
Dropdown，三项菜单：审批人 / 抄送人 / 条件分支，选中后调
`onInsert(containerId, index, nodeType)`。边的 data 携带插入语义（layout.ts:155-165）：
condition→分支卡的边插入该分支首位；分支末→merge 的边插入分支尾；
merge→后继的边插入主链 condition 之后。

### 3.4 分支管理

- **添加分支**：condition 卡片上的 `+`（`onAddBranch`），新分支命名 `条件 N`，
  **插入到默认分支之前**（flow.ts:256-267）。
- **默认分支规则**：`isDefault=true`、固定最后、不可删、不可改名、无条件
  （conditions=[]），摘要「其他条件进入此分支」。
- **删除**：`branches.length <= 2` 不可删（flow.ts:269-275）；默认分支永远不可删。
- **排序**：抽屉里 ArrowUp/ArrowDown 按钮（非拖拽），默认分支不可动，
  目标位钳制到默认分支之前（`reorderBranches`，flow.ts:288-305）。
- **分支条件**：每条 = 字段 Select（来源：关联表单 schema 中 number/money/percent/
  input/select 类型的字段；无绑定表单时降级写死的 `['days','leaveType','金额（元）']`）
  + 操作符 Select（`< ≤ > ≥ = ≠`）+ 值 Input。**多条件为「且」关系**（与后端一致）。
- 载入时 `ensureIds` 补全缺失 id，否则分支内插入会回退到顶层。

### 3.5 保存 / 查看 JSON / 校验

工具栏：流程名称 Input、关联表单 Select（仅启用表单，label `名称（code）`，value=id）、
警告徽章（「未关联表单，保存后不会生成审批模板」、「N 个节点待完善」）、
「查看 JSON」（Modal 展示 `{name, formId, nodes}`）、「保存流程」。

保存校验（FlowDesigner.tsx:292-323）：① 名称非空；② `countIncomplete(nodes) === 0`——
approver 未设审批人且非 deptLeader、cc 未设抄送人、非默认分支存在未填值的条件，
均计为待完善。

接口：`GET /flows`、`POST /flows`、`PUT /flows/{id}`（前端加 `/system` 前缀；
保存后后端自动同步 `FLOW_{id}` 模板，见 1.2）。

---

## 4. 引擎语义（后端状态机）

核心：`service/ApprovalEngineService.java`。实例状态与任务状态是两套：

- **实例 status**：`PENDING`（审批中）→ `APPROVED` / `REJECTED`（终态）；
  `RETURNED`（退回发起人，等 resubmit 复活）。
  实体注释里列了 `CANCELED`，但**引擎从不把实例置 CANCELED**——CANCELED 只是任务终态。
- **任务 status**：`PENDING`（待处理）、`APPROVED`、`REJECTED`、`CC`（抄送记录）、
  `WAITING`（被前加签挂起的原任务）、`CANCELED`（被回退作废，不进任何列表/进度）。

入口方法：`createInstance`（:103）、`approve`（:138）、`reject`（:171）、
`resubmit`（:327）、`addSign`（:356）。

### 4.1 推进与条件求值

推进核心 `advanceFrom(instance, nodes, index)`（:526）：把 flowJson 展开成扁平序列
（`expand`，:629），从 index 起扫描——

- `condition`：调 `selectBranch`（:668）**按分支数组顺序选第一个条件命中的非默认分支；
  都不命中取 isDefault 分支**；分支 children 递归插入序列。condition 节点本身留在
  序列里（带 branchName）仅供进度展示，不产生任务。
- `cc`：直接生成 CC 记录并继续（不阻塞）。
- `approver`：为每个审批人生成 PENDING 任务后**暂停**（return）。
- 序列走完：实例 `APPROVED` + finishedAt + 发 `approval.finished` 事件。

条件求值（`conditionsMatch` :683 + `compare` :704，单测
`ApprovalEngineConditionCompareTest.java` 直接覆盖）：

- 多条件**且**；空 conditions 不命中（默认分支因此永远兜底）。
- 操作符归一化六种：`<`(lt)、`<=`(≤/lte)、`>`(gt)、`>=`(≥/gte)、`!=`(≠/ne)、
  `=`（含 ==/eq）。
- **两边都能解析为数字（含数字字符串 "5"）→ 数值比较**，六种操作符全支持
  （测试明确 `"9" < "10"` 为 true）；否则只有 `=`/`!=` 按字符串精确比较，
  大小比较对非数值操作数判不命中并打 warn。
- 任一操作数为 null/空串 → false；取值 `formData.get(field)` 一层字段。

### 4.2 或签 / 会签

approver 节点解析出多人时**每人生成一条 PENDING 任务**。完成判定 `nodePassed`（:490）：

- 先算 `addSignOpen`：同节点存在 WAITING 任务或未完成加签任务 → 一律不完成。
- **或签（or）**：`!addSignOpen` 即过——一人同意后 `deletePendingSiblings`（:505）
  **物理删除**同节点其余 PENDING 任务再推进（代价：加签链必须走完整条链）。
- **会签（all）**：`!addSignOpen` 且同节点无任何 PENDING 才算集齐。
- 任一驳回 → 走 reject 流程。

审批人解析 `resolveAssignees`（:898）：member 按姓名；role 按角色编码查
`SysUserRepository.findRealNamesByRoleCode`；deptLeader 当前取该部门全部在职人员
（sys_dept 无 leader 字段，代码里有 TODO）。解析为空抛
`IllegalStateException("节点未解析到审批人")`——**拒绝静默通过**。

### 4.3 加签（addSign，:356）

约束：position 仅 `before`/`after`；原任务必须 PENDING；操作人必须是该任务处理人本人；
不能对自己加签；**同一任务最多加签一次**（`existsByParentTaskId`，不允许链式加签）；
节点配 `allowAddSign === false` 时拒绝（找不到节点配置容错为允许）。

```
前加签 before：                        后加签 after：
  原任务 PENDING → WAITING（挂起）        原任务 → APPROVED（记 comment）
  新建 origin=ADD_BEFORE 任务给加签人      新建 origin=ADD_AFTER 任务给加签人
  实例原地不动                           加签人通过后才做 nodePassed 判定再推进
  加签人 approve → 原任务 WAITING→PENDING
  （restoreParentTask，重新通知，仍不推进）
```

加签任务被驳回与普通驳回一致。

### 4.4 驳回四去向（reject，:171；ActRequest.targetType）

| targetType | 语义 | 实现 |
|---|---|---|
| `end`（缺省） | 流程终止，不可恢复 | `rejectToEnd`（:195）：驳回人任务 REJECTED 留痕；**物理删除**全部 PENDING/WAITING；实例 `REJECTED` + finishedAt + **发 approval.finished** |
| `prev` | 驳回到上一审批节点 | `rejectBack`：回退到展开序列中当前节点之前最近的 approver |
| `node` | 驳回到指定节点 | 同上，`targetNodeId` 必填，必须存在、是 approver、在当前节点之前（否则 400） |
| `initiator` | 退回发起人 | `rejectToInitiator`（:209）：其余未处理任务置 **CANCELED**，实例 **RETURNED**，**不发 finished 事件**，通知发起人「可修改后重新提交」 |

`rejectBack`（:229）细节：驳回人任务 REJECTED 留痕；未处理任务全 CANCELED；
被回退区间 `(target, current]` 内的 APPROVED/CC 也置 CANCELED（REJECTED 历史不动）；
目标节点重新生成 PENDING 并通知「驳回后重新审批」；实例保持 PENDING，
`currentNodePath` 指向目标节点。节点路径失配抛异常（不容错为整体驳回，避免丢留痕）。

**resubmit 语义**（:327）：仅实例 RETURNED 且操作人是发起人本人；formData 非空则
覆盖（条件分支重新求值）；实例回 PENDING、finishedAt 置空，**从流程起点重新展开**
（从头走，不是从驳回节点）；**沿用发起时的 flow_snapshot，不更新**。

**CANCELED vs RETURNED**：CANCELED 是任务终态（被回退作废，不进待办/已办/进度）；
RETURNED 是实例的人工干预态（退回发起人），不发结束事件、业务单保持「待审批」，
由发起人 resubmit 复活。实例不存在 CANCELED 终态。

### 4.5 抄送与 CC 列表

cc 节点在 `advanceFrom`（:534-548）：对每个 `ccUsers` 成员生成一条
`nodeType='cc', status='CC'` 的任务记录（只记录不阻塞）+ 通知中心通知（type=CC，
带 businessKey）。抄送列表：`GET /approval/instances/cc?assignee=&page=&size=`，
按 `assigneeName + nodeType='cc' + status='CC'` 倒序分页，返回结构与待办一致
（enrich 包裹 instanceTitle/businessKey/formData 等）。

### 4.6 progress：按序全量展示

详情 `GET /approval/instances/{id}` 返回 `{instance, tasks, currentNode, template,
formSchema, progress}`。`tasks` 按 `sort + id` **全量**（含 CANCELED）。
`progress` 由 `buildProgress`（:775）构建——**按流程顺序全量返回，前端负责截断**：
过滤 CANCELED；approver 节点按任务 id 顺序逐条展开（多轮动作全部留痕不折叠，
加签条目名为「前加签-XX」「后加签-XX」）；condition 一条带 branchName；
「当前点」= 首个含 PENDING/WAITING 的节点，整体 REJECTED 时锚定最新 REJECTED 所在节点。
条目结构 `ProgressNode(nodeId, nodeName, nodeType, origin, signMode, assignees,
status, comment, actedAt, branchName)`，status ∈ DONE/CURRENT/REJECTED/PENDING/CC。

### 4.7 流程版本快照

`createInstance`（:122-124）把 `flow_definition.flow_json` 整体冻结进
`approval_instance.flow_snapshot`。引擎所有展开（推进、驳回回退、进度、resubmit、
加签定位）一律经 `loadInstanceFlow`（:600）读快照——**设计器改定义不影响在途实例**，
resubmit 也不更新快照。唯一回退：历史实例快照为空时读模板当前定义并打 warn。

---

## 5. 审批中心

页面：`frontend/src/pages/approval/center/ApprovalCenter.tsx`（869 行）。
路由：`/approval/center`。审批人标识全链路用 **realName 姓名**（待办/已办/抄送按姓名匹配）。

### 5.1 四个 Tab

`TAB_ITEMS`（:65-70），卡片列表（非表格）：标题 + 模板名 Tag + 发起人 + 创建时间 +
状态 Tag（审批中 blue / 已通过 green / 已驳回 red / 已退回 warning）：

| Tab | 接口（前端加 /system 前缀） | 参数 |
|---|---|---|
| 我的待办 | `GET /approval/instances/todo` | `assignee`（任务 PENDING 且实例 PENDING，id 倒序） |
| 我已办 | `GET /approval/instances/done` | `assignee`（任务 APPROVED/REJECTED，actedAt 倒序） |
| 我发起的 | `GET /approval/instances/mine` | `initiator` |
| 抄送我的 | `GET /approval/instances/cc` | `assignee` |

非 cc 且审批中的卡片显示「当前节点：xxx」；mine 的已退回卡片显示「重新提交」按钮。

### 5.2 详情抽屉（宽 500，四段式）

1. **头部**：标题 + 状态 Tag + meta（模板 · 发起人 · 时间 + businessKey）。
2. **表单数据**：`<SchemaForm schema={detail.formSchema} mode="readonly"
   initialValues={detail.instance.formData} />`。
3. **审批进度**（`ApprovalProgress`）：固定首节点「发起申请」+ progress 节点链
   （类型图标 + 加签/会签 Tag + 状态徽标 + 审批人头像 + condition 命中分支名 +
   意见 + 时间）+ 结束节点（已退回/已驳回/流程结束）。驳回后截断：最后一条
   NORMAL 的 REJECTED 之后的 PENDING/CURRENT 不再显示。
4. **操作区**（仅当前用户有待处理任务时出现）：审批意见 TextArea + 三按钮——
   **驳回**（danger，开弹窗）/ **加签**（节点 `allowAddSign !== false` 才显示）/
   **同意**（primary）。没有转交功能。无待办时显示「当前节点「x」· 等待 xx 处理」。

### 5.3 加签 / 驳回的操作入口

- **加签弹窗**（:741-786）：方式二选一——前加签「我先不审，先由 TA 审」（默认）/
  后加签「我审完后由 TA 再审」；加签人 Select（`GET /system/users`，过滤自己）；
  意见选填。成功文案区分「已加签给 X」/「已同意并加签给 X」。
  接口 `POST /approval/tasks/{id}/add-sign`，body `{position, assignee, comment?}`。
- **驳回弹窗**（:789-847）：去向 Radio 四选——`end` 直接驳回（默认，「流程终止，
  不可恢复」）/ `prev` 上一审批节点 / `node` 指定节点（候选为 progress 中
  status=DONE 的 approver 节点，选中后出二级 Select）/ `initiator` 退回发起人
  （「可修改表单后重新提交」）。意见必填；node 必须选目标节点。
  接口 `POST /approval/tasks/{id}/reject`，body `{comment, targetType, targetNodeId?}`。
- **重新提交**：mine 列表行与详情抽屉两个入口共用 Modal；用 SchemaForm edit 模式
  重填表单（date/dateRange 做字符串↔dayjs 互转），提交
  `POST /approval/instances/{id}/resubmit`，仅发起人本人、仅 RETURNED 态。

---

## 6. 发起审批

### 6.1 发起页（用户手工发起）

页面：`frontend/src/pages/approval/launch/Launch.tsx`，路由 `/approval/launch`。
进入时并行拉 `GET /system/approval/templates` + `/system/forms` + `/system/flows`，
只展示启用模板；卡片显示模板名 + 关联表单/流程（未关联表单的卡片禁用，
Tooltip「该模板未关联表单，无法发起」）。

发起弹窗（宽 720）：审批标题 Input（默认 `${模板名}-${发起人姓名}`）+
`<SchemaForm formCode={关联表单.code} mode="edit" />`；提交
`POST /system/approval/instances`，body `{templateCode, title,
businessKey: 'manual:' + Date.now(), formData}`；成功跳 `/approval/center`。

### 6.2 业务侧内调发起（/internal/approval/instances）

`InternalApprovalController`（`/internal`，**无 JWT**——注释明确禁止暴露网关/公网，
生产应加内网令牌/mTLS）：

```
POST /internal/approval/instances
{
  "templateCode": "FLOW_3",        // 必填，按 code 找模板；模板停用抛"审批模板已停用"
  "businessKey":  "leave:123",     // 业务方关联键（自定义，有索引）
  "title":        "张三的请假申请",   // 必填
  "formData":     { "days": 5, ... },
  "initiatorName": "张三"           // 内调时 initiatorId=null，发起人姓名由调用方传
}
```

与登录态 `POST /approval/instances` 同逻辑（登录态发起人取 JWT realName）。
`businessKey` 存在实例上，后续通知、抄送、事件都带着它回传业务方。

### 6.3 approval.finished 事件回写业务状态

- **发布时机**（`publishFinished`，:587）：仅两处——流程全部走完（实例 APPROVED）、
  整体驳回（`rejectToEnd`，实例 REJECTED）。prev/node 回退、initiator 退回
  （RETURNED）、加签、resubmit 均**不发**。
- **通道**：RabbitMQ topic exchange `framework.events`（durable），
  routing key `approval.finished`；发布失败仅 warn 不影响主流程
  （`ApprovalEventPublisher`，注释称业务方状态由对账/重推兜底）。
- **事件体**（`mq/ApprovalFinishedEvent.java`，Serializable）：
  `{ templateCode, businessKey, status }`，status 只会是 `APPROVED` / `REJECTED`。
- **消费模式**：本仓库内没有消费者——`RabbitConfig` 注释明确「approval.finished 的
  消费队列由消费方（业务服务）声明」。业务服务按 exchange/routing key/三字段契约
  自行声明队列绑定，收到后按 `businessKey` 找回业务单、按 `status` 回写业务状态。
  反向范例可参考 `notification.send`（biz 发事件、system 侧
  `NotificationSendListener` 消费，`idClassMapping` 做跨模块 DTO 映射）。

```
业务服务                        framework-system
   │  POST /internal/approval/instances          │
   │ ─────────────────────────►  创建实例(快照流程) │
   │      businessKey=leave:123   状态 PENDING     │
   │                            …逐级审批…         │
   │  RabbitMQ: approval.finished                │
   │  {templateCode,businessKey,status=APPROVED} │
   │ ◄─────────────────────────  终态事件          │
   │  按 businessKey 回写 leave:123 状态           │
```

注意：RETURNED（退回发起人）不算终态，业务方收不到事件、业务单应保持「审批中」；
若业务需要感知退回，只能轮询实例状态或自行扩展（当前引擎未发该事件）。
