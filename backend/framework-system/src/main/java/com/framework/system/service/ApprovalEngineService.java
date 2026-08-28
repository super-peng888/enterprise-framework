package com.framework.system.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import com.framework.system.entity.ApprovalInstance;
import com.framework.system.entity.ApprovalTask;
import com.framework.system.entity.ApprovalTemplate;
import com.framework.system.entity.FlowDefinition;
import com.framework.system.entity.FormDefinition;
import com.framework.system.entity.SysUser;
import com.framework.system.mq.ApprovalEventPublisher;
import com.framework.system.repository.ApprovalInstanceRepository;
import com.framework.system.repository.ApprovalTaskRepository;
import com.framework.system.repository.ApprovalTemplateRepository;
import com.framework.system.repository.FlowDefinitionRepository;
import com.framework.system.repository.FormDefinitionRepository;
import com.framework.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 审批引擎（自研轻量状态机，不引 Flowable）。
 *
 * 推进逻辑：
 * 1. 按实例创建时冻结的 flow_snapshot（流程版本快照，内容为当时的 flow_definition.flow_json）
 *    主链顺序展开为扁平执行序列；设计器后续修改流程定义不影响在途实例，resubmit 也沿用
 *    原快照（实例始终按发起时的流程版本走）。历史实例（快照为空）回退读模板当前流程定义。
 *    遇 condition 节点按分支条件（对 form_data 字段做 &lt; ≤ &gt; ≥ = ≠ 类型感知比较：
 *    两边均可解析为数值则数值比较，否则仅 = / ≠ 按字符串比、其余操作符判不命中，
 *    多条件「且」）选第一个命中的非默认分支，否则默认分支，把分支 children 递归插入序列。
 *    form_data 在实例创建后不变，因此展开结果是确定的，每次推进时重算即可。
 * 2. approver 节点按解析后的审批人生成 PENDING 任务并暂停推进；
 *    cc 节点只生成 CC 记录（同时给被抄送人发 type=CC 的通知）、不阻塞，继续推进下一节点。
 * 3. 或签（or）：任一人通过即过；会签（all）：全部通过才过。任一驳回 → 实例 REJECTED。
 * 4. 全部节点走完 → 实例 APPROVED。结束（通过/驳回）后发 approval.finished 事件到 framework.events。
 * 5. 加签：处理人可在自己的 PENDING 任务上前加签（before，原任务挂起 WAITING，加签人
 *    通过后恢复原任务 PENDING，节点不推进）或后加签（after，原任务记 comment 置 APPROVED，
 *    新建加签任务继续占住本节点）。加签任务驳回与其他驳回一致 → 实例 REJECTED。
 *    节点完成判定把加签链算在内：存在 WAITING 或未完成的加签任务时节点不完成。
 * 6. 驳回到指定节点（仿飞书）：reject 支持 targetType=end(默认)/prev/node/initiator。
 *    prev/node 回退到当前节点之前的某个 approver 节点：驳回人任务记 REJECTED 留痕，
 *    未处理任务（PENDING/WAITING）与被回退区间 (target, current] 的 APPROVED/CC 任务置
 *    CANCELED（任务终态，不进任何列表、不参与进度），目标节点按配置重新生成 PENDING 任务，
 *    实例保持 PENDING。initiator 退回发起人：实例置 RETURNED（终态前的人工干预态），
 *    不发 approval.finished（业务单保持「待审批」），由发起人 resubmit 后从起点重新展开。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ApprovalEngineService {

    private static final String STATUS_PENDING = "PENDING";
    private static final String STATUS_APPROVED = "APPROVED";
    private static final String STATUS_REJECTED = "REJECTED";
    private static final String STATUS_WAITING = "WAITING";
    /** 任务终态：被回退作废（PENDING/WAITING/被覆盖的 APPROVED/CC），不进列表、不参与进度。 */
    private static final String STATUS_CANCELED = "CANCELED";
    /** 实例状态：退回发起人，等发起人重新提交（resubmit 后回到 PENDING）。 */
    private static final String STATUS_RETURNED = "RETURNED";
    private static final String STATUS_CC = "CC";

    private static final String ORIGIN_NORMAL = "NORMAL";
    private static final String ORIGIN_ADD_BEFORE = "ADD_BEFORE";
    private static final String ORIGIN_ADD_AFTER = "ADD_AFTER";

    private final ApprovalTemplateRepository templateRepository;
    private final FlowDefinitionRepository flowRepository;
    private final FormDefinitionRepository formRepository;
    private final ApprovalInstanceRepository instanceRepository;
    private final ApprovalTaskRepository taskRepository;
    private final SysUserRepository userRepository;
    private final ApprovalEventPublisher eventPublisher;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 展开后的节点（approver/cc/condition）。condition 不产生任务，仅保留在序列中
     * 供进度展示（branchName 为按 form_data 命中的分支名）；推进时跳过。
     */
    private record FlatNode(String nodeId, String name, String type,
                            String approverType, List<String> approvers, String signMode,
                            List<String> ccUsers, String branchName) {
    }

    /** 审批中心详情用进度节点。status：DONE/CURRENT/REJECTED/PENDING/CC；
     *  origin：NORMAL/ADD_BEFORE/ADD_AFTER（condition/cc 为 null）。 */
    public record ProgressNode(String nodeId, String nodeName, String nodeType, String origin, String signMode,
                               List<String> assignees, String status, String comment,
                               LocalDateTime actedAt, String branchName) {
    }

    /**
     * 创建审批实例并生成首个节点的任务。
     */
    @Transactional
    public ApprovalInstance createInstance(String templateCode, String businessKey, String title,
                                           JsonNode formData, Long initiatorId, String initiatorName) {
        ApprovalTemplate template = templateRepository.findByCode(templateCode)
                .orElseThrow(() -> new IllegalArgumentException("审批模板不存在: " + templateCode));
        if (!"启用".equals(template.getStatus())) {
            throw new IllegalStateException("审批模板已停用: " + templateCode);
        }

        ApprovalInstance instance = new ApprovalInstance();
        instance.setTemplateId(template.getId());
        instance.setTitle(title);
        instance.setBusinessKey(businessKey);
        instance.setFormData(formData == null ? null : formData.toString());
        instance.setStatus(STATUS_PENDING);
        instance.setInitiatorId(initiatorId);
        instance.setInitiatorName(initiatorName);
        // 冻结流程版本快照：实例后续所有展开（推进/进度/驳回回退/resubmit）一律按快照求值，
        // 设计器对 flow_definition 的修改不影响在途实例
        FlowDefinition flow = flowRepository.findById(template.getFlowId())
                .orElseThrow(() -> new IllegalStateException("流程定义不存在: " + template.getFlowId()));
        instance.setFlowSnapshot(flow.getFlowJson());
        // 冻结表单版本快照：实例详情回显一律按快照，表单设计器后续修改不影响在途实例；
        // 模板未绑定表单或表单已被删除则快照为 null（详情回退读当前表单定义）
        if (template.getFormId() != null) {
            formRepository.findById(template.getFormId())
                    .map(FormDefinition::getSchema)
                    .ifPresent(instance::setFormSnapshot);
        }
        instanceRepository.save(instance);

        List<FlatNode> nodes = expandNodes(flowNodes(flow.getFlowJson(), "flowId=" + flow.getId()), formData);
        advanceFrom(instance, nodes, 0);
        return instance;
    }

    /**
     * 审批通过：记录任务结果并按签批模式推进状态机。
     * 前加签任务（ADD_BEFORE）通过后只恢复被挂起的原任务（WAITING→PENDING），节点不推进；
     * 后加签/普通任务通过后走节点完成判定。
     */
    @Transactional
    public ApprovalInstance approve(Long taskId, String comment) {
        return approve(taskId, comment, null);
    }

    /**
     * 审批通过（字段级审批权限）：formData 非空时按节点 fieldPerms 白名单 merge
     * editable 字段进实例 form_data，其余推进逻辑与 {@link #approve(Long, String)} 一致。
     */
    @Transactional
    public ApprovalInstance approve(Long taskId, String comment, Map<String, Object> formData) {
        ApprovalTask task = loadPendingTask(taskId);
        task.setStatus(STATUS_APPROVED);
        task.setComment(comment);
        task.setActedAt(LocalDateTime.now());
        taskRepository.save(task);

        ApprovalInstance instance = loadPendingInstance(task.getInstanceId());
        // 字段 merge 须在推进前完成：条件分支按最新 form_data 求值
        if (formData != null && !formData.isEmpty()) {
            mergeEditableFields(task, instance, formData);
        }
        if (ORIGIN_ADD_BEFORE.equals(task.getOrigin())) {
            // 前加签完成：恢复原任务待办并重新通知原审批人，节点停留在原地
            restoreParentTask(task, instance);
            return instance;
        }
        if (!nodePassed(task)) {
            // 会签未集齐，或加签链未走完（或签），停留在当前节点
            return instance;
        }
        // 节点通过：清理同节点其余未处理任务（或签场景），推进下一节点
        deletePendingSiblings(task);
        advance(instance, task.getNodeId());
        return instance;
    }

    /**
     * 字段级审批权限：审批人点「同意」时可携带编辑过的表单字段。
     * 按任务所在节点的 fieldPerms（流程快照内节点配置，key=字段编码）白名单校验：
     * 仅放行值为 "editable" 的 key 浅 merge 进实例 form_data，其余 key 静默丢弃并打 warn；
     * 节点未配置 fieldPerms 或找不到节点时全部丢弃（安全默认：不允许审批人改表单）。
     */
    private void mergeEditableFields(ApprovalTask task, ApprovalInstance instance, Map<String, Object> formData) {
        JsonNode nodeJson = findNodeJson(instance, task.getNodeId());
        JsonNode fieldPerms = nodeJson == null ? null : nodeJson.path("fieldPerms");
        if (fieldPerms == null || !fieldPerms.isObject() || fieldPerms.size() == 0) {
            log.warn("审批节点未配置字段权限，丢弃审批人提交的表单字段: taskId={}, keys={}",
                    task.getId(), formData.keySet());
            return;
        }
        JsonNode current = parseJson(instance.getFormData());
        ObjectNode merged = current instanceof ObjectNode o ? o : objectMapper.createObjectNode();
        List<String> allowed = new ArrayList<>();
        List<String> dropped = new ArrayList<>();
        formData.forEach((key, value) -> {
            if ("editable".equals(fieldPerms.path(key).asText())) {
                merged.set(key, objectMapper.valueToTree(value));
                allowed.add(key);
            } else {
                dropped.add(key);
            }
        });
        if (!dropped.isEmpty()) {
            log.warn("审批人提交的字段不在 editable 白名单内，已丢弃: taskId={}, keys={}", task.getId(), dropped);
        }
        if (!allowed.isEmpty()) {
            instance.setFormData(merged.toString());
            instanceRepository.save(instance);
            // 审计留痕：操作人为任务审批人，记录实际 merge 的字段 key
            log.info("审批人 {} 在节点「{}」修改表单字段: instanceId={}, keys={}",
                    task.getAssigneeName(), task.getNodeName(), instance.getId(), allowed);
        }
    }

    /**
     * 驳回。targetType：
     * - end（缺省）：任务与实例置 REJECTED，清理全部待办/挂起任务，发审批结束事件（现状不变）。
     * - prev：回退到展开序列中当前节点之前最近的 approver 节点。
     * - node：回退到 targetNodeId 指定的、且在当前节点之前的 approver 节点（否则 400）。
     * - initiator：退回发起人，实例置 RETURNED，不发审批结束事件，等发起人 resubmit。
     * prev/node/initiator 三种：驳回人任务记 REJECTED 留痕（含 comment），其余未处理任务
     * （PENDING/WAITING）一律置 CANCELED。
     */
    @Transactional
    public ApprovalInstance reject(Long taskId, String comment, String targetType, String targetNodeId) {
        if (comment == null || comment.isBlank()) {
            throw new IllegalArgumentException("驳回意见不能为空");
        }
        ApprovalTask task = loadPendingTask(taskId);
        ApprovalInstance instance = loadPendingInstance(task.getInstanceId());

        String type = (targetType == null || targetType.isBlank()) ? "end" : targetType.trim();
        switch (type) {
            case "end" -> rejectToEnd(task, instance, comment);
            case "prev" -> rejectBack(task, instance, comment, null);
            case "node" -> {
                if (targetNodeId == null || targetNodeId.isBlank()) {
                    throw new IllegalArgumentException("targetType=node 时 targetNodeId 必填");
                }
                rejectBack(task, instance, comment, targetNodeId.trim());
            }
            case "initiator" -> rejectToInitiator(task, instance, comment);
            default -> throw new IllegalArgumentException("不支持的驳回目标类型: " + targetType);
        }
        return instance;
    }

    /** 整体驳回（现状）：实例 REJECTED + 清理待办/挂起任务 + 发 approval.finished。 */
    private void rejectToEnd(ApprovalTask task, ApprovalInstance instance, String comment) {
        markRejected(task, comment);
        // 同时清理被前加签挂起的 WAITING 任务，避免悬挂
        taskRepository.findByInstanceIdAndStatusIn(instance.getId(),
                        List.of(STATUS_PENDING, STATUS_WAITING))
                .forEach(taskRepository::delete);
        instance.setStatus(STATUS_REJECTED);
        instance.setCurrentNodePath(null);
        instance.setFinishedAt(LocalDateTime.now());
        instanceRepository.save(instance);
        publishFinished(instance);
    }

    /** 退回发起人：实例 RETURNED，未处理任务 CANCELED，不发 approval.finished（业务单保持待审批）。 */
    private void rejectToInitiator(ApprovalTask task, ApprovalInstance instance, String comment) {
        markRejected(task, comment);
        cancelTasks(taskRepository.findByInstanceIdAndStatusIn(instance.getId(),
                List.of(STATUS_PENDING, STATUS_WAITING)));
        instance.setStatus(STATUS_RETURNED);
        instance.setCurrentNodePath(null);
        instanceRepository.save(instance);
        notificationService.create(instance.getInitiatorName(), "APPROVAL",
                "审批被退回，请修改后重新提交：" + instance.getTitle(),
                "「" + task.getAssigneeName() + "」在节点「" + task.getNodeName() + "」将「" + instance.getTitle()
                        + "」退回给您，驳回意见：" + comment,
                "approval:" + instance.getId());
    }

    /**
     * 驳回到前置节点（targetNodeId 为 null 时取当前节点之前最近的 approver 节点）。
     * 驳回人任务 REJECTED 留痕；当前节点及之后未处理任务、被回退区间 (target, current]
     * 内已产生的 APPROVED/CC 任务全部 CANCELED（重跑时按节点配置重新生成）；
     * 目标节点重新生成 PENDING 任务并通知「驳回后重新审批」，实例保持 PENDING。
     */
    private void rejectBack(ApprovalTask task, ApprovalInstance instance, String comment, String targetNodeId) {
        List<FlatNode> nodes = expandNodes(loadInstanceFlow(instance), parseJson(instance.getFormData()));
        int currentIndex = nodeIndex(nodes, task.getNodeId());
        if (currentIndex < 0) {
            // 流程定义变更导致节点路径失配，不允许回退（容错为整体驳回会丢留痕，直接报错更安全）
            throw new IllegalStateException("当前节点不在流程定义中，无法回退: " + task.getNodeId());
        }
        int targetIndex = resolveTargetIndex(nodes, currentIndex, targetNodeId);
        FlatNode target = nodes.get(targetIndex);

        markRejected(task, comment);
        for (ApprovalTask t : taskRepository.findByInstanceIdOrderBySortAscIdAsc(instance.getId())) {
            if (t.getId().equals(task.getId())) {
                continue;
            }
            if (STATUS_PENDING.equals(t.getStatus()) || STATUS_WAITING.equals(t.getStatus())) {
                t.setStatus(STATUS_CANCELED);
                taskRepository.save(t);
                continue;
            }
            // 被回退区间内的已通过/已抄送任务作废（重跑时会重新生成）；REJECTED 历史留痕不动
            if ((STATUS_APPROVED.equals(t.getStatus()) || STATUS_CC.equals(t.getStatus()))) {
                int idx = nodeIndex(nodes, t.getNodeId());
                if (idx > targetIndex && idx <= currentIndex) {
                    t.setStatus(STATUS_CANCELED);
                    taskRepository.save(t);
                }
            }
        }

        List<String> assignees = resolveAssignees(target);
        if (assignees.isEmpty()) {
            throw new IllegalStateException("节点「" + target.name() + "」未解析到审批人");
        }
        int sort = taskRepository.maxSort(instance.getId());
        for (String assignee : assignees) {
            taskRepository.save(newTask(instance, target, assignee, ++sort));
            notificationService.create(assignee, "APPROVAL",
                    "驳回后重新审批：" + instance.getTitle(),
                    "「" + task.getAssigneeName() + "」将「" + instance.getTitle() + "」驳回到节点「"
                            + target.name() + "」，驳回意见：" + comment + "，请重新审批。",
                    "approval:" + instance.getId());
        }
        instance.setCurrentNodePath(target.nodeId() + " " + target.name());
        instanceRepository.save(instance);
    }

    /** prev：当前节点之前最近的 approver 节点；node：指定的前置 approver 节点。 */
    private int resolveTargetIndex(List<FlatNode> nodes, int currentIndex, String targetNodeId) {
        if (targetNodeId == null) {
            for (int i = currentIndex - 1; i >= 0; i--) {
                if ("approver".equals(nodes.get(i).type())) {
                    return i;
                }
            }
            throw new IllegalArgumentException("当前节点之前没有可回退的审批节点");
        }
        int idx = nodeIndex(nodes, targetNodeId);
        if (idx < 0 || !"approver".equals(nodes.get(idx).type())) {
            throw new IllegalArgumentException("目标节点不存在或不是审批节点: " + targetNodeId);
        }
        if (idx >= currentIndex) {
            throw new IllegalArgumentException("只能驳回到当前节点之前的节点: " + targetNodeId);
        }
        return idx;
    }

    private int nodeIndex(List<FlatNode> nodes, String nodeId) {
        for (int i = 0; i < nodes.size(); i++) {
            if (nodes.get(i).nodeId().equals(nodeId)) {
                return i;
            }
        }
        return -1;
    }

    private void markRejected(ApprovalTask task, String comment) {
        task.setStatus(STATUS_REJECTED);
        task.setComment(comment);
        task.setActedAt(LocalDateTime.now());
        taskRepository.save(task);
    }

    private void cancelTasks(List<ApprovalTask> tasks) {
        for (ApprovalTask t : tasks) {
            t.setStatus(STATUS_CANCELED);
            taskRepository.save(t);
        }
    }

    /**
     * 重新提交：仅实例发起人本人（控制器校验 JWT realName 与 initiatorName 一致传入）
     * 且实例处于 RETURNED（被退回发起人）。formData 非空则覆盖实例 form_data（条件分支
     * 重新求值），实例回到 PENDING，从流程起点重新展开生成首个节点任务（advanceFrom 内发通知）。
     * 展开沿用创建时冻结的 flow_snapshot（不更新快照）：实例始终按发起时的流程版本走，
     * 即使流程定义已被修改。
     */
    @Transactional
    public ApprovalInstance resubmit(Long instanceId, JsonNode formData, String operatorName) {
        ApprovalInstance instance = instanceRepository.findById(instanceId)
                .orElseThrow(() -> new IllegalArgumentException("审批实例不存在: " + instanceId));
        if (!STATUS_RETURNED.equals(instance.getStatus())) {
            throw new IllegalStateException("仅被退回（RETURNED）的实例可重新提交，当前状态: " + instance.getStatus());
        }
        if (!Objects.equals(instance.getInitiatorName(), operatorName)) {
            throw new IllegalStateException("仅发起人本人可重新提交");
        }
        if (formData != null) {
            instance.setFormData(formData.toString());
        }
        instance.setStatus(STATUS_PENDING);
        instance.setFinishedAt(null);
        instanceRepository.save(instance);

        List<FlatNode> nodes = expandNodes(loadInstanceFlow(instance), parseJson(instance.getFormData()));
        advanceFrom(instance, nodes, 0);
        return instance;
    }

    /**
     * 加签：操作人必须是任务当前处理人本人，且任务处于 PENDING。
     * 前加签（before）：原任务挂起为 WAITING，新建 ADD_BEFORE 任务给指定人，实例不推进；
     * 后加签（after）：原任务记 comment 置 APPROVED，新建 ADD_AFTER 任务占住本节点，
     * 指定人通过后才做节点完成判定。
     * v1 限制：同一任务最多加签一次（前后合计），不允许链式加签。
     */
    @Transactional
    public ApprovalTask addSign(Long taskId, String position, String assignee, String comment, String operator) {
        if (!"before".equals(position) && !"after".equals(position)) {
            throw new IllegalArgumentException("position 仅支持 before/after");
        }
        ApprovalTask task = taskRepository.findById(taskId)
                .orElseThrow(() -> new IllegalArgumentException("审批任务不存在: " + taskId));
        if (STATUS_WAITING.equals(task.getStatus())) {
            throw new IllegalStateException("该任务已被前加签挂起，不能再加签");
        }
        if (!STATUS_PENDING.equals(task.getStatus())) {
            throw new IllegalStateException("任务已处理，不能加签: " + taskId);
        }
        if (!task.getAssigneeName().equals(operator)) {
            throw new IllegalStateException("只有任务处理人本人才能加签");
        }
        if (task.getAssigneeName().equals(assignee)) {
            throw new IllegalArgumentException("不能对自己加签");
        }
        ApprovalInstance instance = loadPendingInstance(task.getInstanceId());
        if (taskRepository.existsByParentTaskId(task.getId())) {
            throw new IllegalStateException("该任务已加签过，同一任务最多加签一次");
        }
        // 节点配置可禁用加签：flow_json 节点 allowAddSign === false 时拒绝，缺省允许
        JsonNode nodeJson = findNodeJson(instance, task.getNodeId());
        if (nodeJson != null && nodeJson.path("allowAddSign").isBoolean()
                && !nodeJson.path("allowAddSign").asBoolean()) {
            throw new IllegalStateException("该节点不允许加签");
        }

        ApprovalTask addSignTask = new ApprovalTask();
        addSignTask.setInstanceId(instance.getId());
        addSignTask.setNodeId(task.getNodeId());
        addSignTask.setNodeName(task.getNodeName());
        addSignTask.setNodeType(task.getNodeType());
        addSignTask.setAssigneeName(assignee);
        addSignTask.setSignMode(task.getSignMode());
        addSignTask.setStatus(STATUS_PENDING);
        addSignTask.setParentTaskId(task.getId());
        addSignTask.setSort(taskRepository.maxSort(instance.getId()) + 1);

        String label;
        if ("before".equals(position)) {
            task.setStatus(STATUS_WAITING);
            addSignTask.setOrigin(ORIGIN_ADD_BEFORE);
            label = "前加签";
        } else {
            task.setStatus(STATUS_APPROVED);
            task.setComment(comment);
            task.setActedAt(LocalDateTime.now());
            addSignTask.setOrigin(ORIGIN_ADD_AFTER);
            label = "后加签";
        }
        taskRepository.save(task);
        ApprovalTask saved = taskRepository.save(addSignTask);
        notificationService.create(assignee, "APPROVAL",
                "新审批任务（" + label + "）：" + instance.getTitle(),
                "「" + operator + "」将「" + instance.getTitle() + "」节点「" + task.getNodeName()
                        + "」的审批" + label + "给您，请及时处理。",
                "approval:" + instance.getId());
        return saved;
    }

    /** 前加签通过后：父任务 WAITING→PENDING，并给原审批人重新生成待办通知。 */
    private void restoreParentTask(ApprovalTask addSignTask, ApprovalInstance instance) {
        if (addSignTask.getParentTaskId() == null) {
            return;
        }
        taskRepository.findById(addSignTask.getParentTaskId()).ifPresent(parent -> {
            parent.setStatus(STATUS_PENDING);
            taskRepository.save(parent);
            notificationService.create(parent.getAssigneeName(), "APPROVAL",
                    "加签完成，请继续审批：" + instance.getTitle(),
                    "「" + addSignTask.getAssigneeName() + "」已完成前加签审批，「" + instance.getTitle()
                            + "」节点「" + parent.getNodeName() + "」待您继续审批。",
                    "approval:" + instance.getId());
        });
    }

    /**
     * 按 nodeId（索引路径，如 "1/0/0"）在流程快照中定位节点配置，用于读取 allowAddSign/fieldPerms；
     * 找不到（模板/流程被删、无快照或路径失配）返回 null，调用方按各自安全默认容错。
     */
    private JsonNode findNodeJson(ApprovalInstance instance, String nodeId) {
        try {
            return walkNode(loadInstanceFlow(instance), nodeId.split("/"), 0);
        } catch (RuntimeException e) {
            log.warn("定位流程节点配置失败 nodeId={}: {}", nodeId, e.getMessage());
            return null;
        }
    }

    /** 与 expand 的 nodeId 编码对应：普通节点消费 1 段；condition 之后一段为分支索引，再进入其 children。 */
    private JsonNode walkNode(JsonNode nodes, String[] segs, int pos) {
        if (nodes == null || !nodes.isArray() || pos >= segs.length) {
            return null;
        }
        int idx;
        try {
            idx = Integer.parseInt(segs[pos]);
        } catch (NumberFormatException e) {
            return null;
        }
        if (idx < 0 || idx >= nodes.size()) {
            return null;
        }
        JsonNode node = nodes.get(idx);
        if (pos == segs.length - 1) {
            return node;
        }
        if (!"condition".equals(node.path("type").asText("")) || pos + 1 >= segs.length) {
            return null;
        }
        int branchIdx;
        try {
            branchIdx = Integer.parseInt(segs[pos + 1]);
        } catch (NumberFormatException e) {
            return null;
        }
        JsonNode branches = node.path("branches");
        if (!branches.isArray() || branchIdx < 0 || branchIdx >= branches.size()) {
            return null;
        }
        return walkNode(branches.get(branchIdx).path("children"), segs, pos + 2);
    }

    // ---------------- 状态机内部 ----------------

    /**
     * 节点是否已通过。加签链视为节点的一部分：存在被挂起的 WAITING 任务或未处理完的
     * 加签任务（PENDING 且 origin≠NORMAL）时，节点一律不完成。
     * 或签（or）：一人通过即过，但加签链未走完时其他人通过也不能完成节点
     * （取舍：或签下加签链等价为必须走完整条链，链走完后由加签任务的通过触发完成判定）。
     * 会签（all）：无任何 PENDING/WAITING 任务才算集齐。
     */
    private boolean nodePassed(ApprovalTask actedTask) {
        List<ApprovalTask> nodeTasks = taskRepository.findByInstanceIdAndNodeId(
                actedTask.getInstanceId(), actedTask.getNodeId());
        boolean addSignOpen = nodeTasks.stream().anyMatch(t -> STATUS_WAITING.equals(t.getStatus())
                || (STATUS_PENDING.equals(t.getStatus()) && !isNormal(t)));
        if ("or".equalsIgnoreCase(actedTask.getSignMode())) {
            return !addSignOpen;
        }
        return !addSignOpen && nodeTasks.stream().noneMatch(t -> STATUS_PENDING.equals(t.getStatus()));
    }

    private boolean isNormal(ApprovalTask task) {
        return task.getOrigin() == null || ORIGIN_NORMAL.equals(task.getOrigin());
    }

    private void deletePendingSiblings(ApprovalTask actedTask) {
        taskRepository.findByInstanceIdAndNodeId(actedTask.getInstanceId(), actedTask.getNodeId())
                .stream()
                .filter(t -> STATUS_PENDING.equals(t.getStatus()))
                .forEach(taskRepository::delete);
    }

    /** 从当前节点之后继续推进（按实例流程快照展开）。 */
    private void advance(ApprovalInstance instance, String currentNodeId) {
        List<FlatNode> nodes = expandNodes(loadInstanceFlow(instance), parseJson(instance.getFormData()));
        int nextIndex = nodes.size();
        for (int i = 0; i < nodes.size(); i++) {
            if (nodes.get(i).nodeId().equals(currentNodeId)) {
                nextIndex = i + 1;
                break;
            }
        }
        advanceFrom(instance, nodes, nextIndex);
    }

    /** 从 flat 序列 index 起处理节点：cc 直接记录并继续，approver 生成任务后停；走完则实例通过。 */
    private void advanceFrom(ApprovalInstance instance, List<FlatNode> nodes, int index) {
        int sort = taskRepository.maxSort(instance.getId());
        for (int i = index; i < nodes.size(); i++) {
            FlatNode node = nodes.get(i);
            if ("condition".equals(node.type())) {
                // 条件节点不产生任务，仅用于进度展示
                continue;
            }
            if ("cc".equals(node.type())) {
                for (String ccUser : node.ccUsers()) {
                    ApprovalTask task = newTask(instance, node, ccUser, ++sort);
                    task.setStatus(STATUS_CC);
                    task.setActedAt(LocalDateTime.now());
                    taskRepository.save(task);
                    // 抄送通知：被抄送人在通知中心可见（type=CC，bizKey 为实例业务单号）
                    notificationService.create(ccUser, "CC",
                            "抄送：" + instance.getTitle(),
                            "「" + instance.getTitle() + "」审批流转到节点「" + node.name()
                                    + "」，抄送给您知悉。",
                            instance.getBusinessKey());
                }
                continue;
            }
            List<String> assignees = resolveAssignees(node);
            if (assignees.isEmpty()) {
                // 审批人解析为空视为配置错误，跳过会静默通过节点，改为直接失败便于暴露问题
                throw new IllegalStateException("节点「" + node.name() + "」未解析到审批人");
            }
            for (String assignee : assignees) {
                taskRepository.save(newTask(instance, node, assignee, ++sort));
                // 审批任务创建即给审批人生成 APPROVAL 通知（通知中心）
                notificationService.create(assignee, "APPROVAL",
                        "新审批任务：" + instance.getTitle(),
                        "您有一个待办审批：「" + instance.getTitle() + "」，当前节点：" + node.name() + "。",
                        "approval:" + instance.getId());
            }
            instance.setCurrentNodePath(node.nodeId() + " " + node.name());
            instanceRepository.save(instance);
            return;
        }
        // 全部节点走完
        instance.setStatus(STATUS_APPROVED);
        instance.setCurrentNodePath(null);
        instance.setFinishedAt(LocalDateTime.now());
        instanceRepository.save(instance);
        publishFinished(instance);
    }

    private ApprovalTask newTask(ApprovalInstance instance, FlatNode node, String assignee, int sort) {
        ApprovalTask task = new ApprovalTask();
        task.setInstanceId(instance.getId());
        task.setNodeId(node.nodeId());
        task.setNodeName(node.name());
        task.setNodeType(node.type());
        task.setAssigneeName(assignee);
        task.setSignMode(node.signMode());
        task.setStatus(STATUS_PENDING);
        task.setSort(sort);
        return task;
    }

    private void publishFinished(ApprovalInstance instance) {
        String templateCode = templateRepository.findById(instance.getTemplateId())
                .map(ApprovalTemplate::getCode).orElse(null);
        eventPublisher.publishFinished(templateCode, instance.getBusinessKey(), instance.getStatus());
    }

    // ---------------- 流程展开 ----------------

    /**
     * 取实例的流程节点数组（nodes）：一律按创建时冻结的 flow_snapshot 展开，
     * 设计器后续修改 flow_definition 不影响在途实例。
     * 历史实例（快照为空）回退读模板当前流程定义并打 warn（仅此兼容路径还依赖 flow_definition）。
     */
    private JsonNode loadInstanceFlow(ApprovalInstance instance) {
        String snapshot = instance.getFlowSnapshot();
        if (snapshot != null && !snapshot.isBlank()) {
            return flowNodes(snapshot, "instanceId=" + instance.getId() + " 流程快照");
        }
        log.warn("实例无流程快照，回退读模板当前流程定义: instanceId={}", instance.getId());
        ApprovalTemplate template = templateRepository.findById(instance.getTemplateId())
                .orElseThrow(() -> new IllegalStateException("审批模板不存在: " + instance.getTemplateId()));
        FlowDefinition flow = flowRepository.findById(template.getFlowId())
                .orElseThrow(() -> new IllegalStateException("流程定义不存在: " + template.getFlowId()));
        return flowNodes(flow.getFlowJson(), "flowId=" + flow.getId());
    }

    /** 解析 flow_json 并校验/返回 nodes 数组。 */
    private JsonNode flowNodes(String flowJson, String source) {
        JsonNode root = parseJson(flowJson);
        if (root == null || !root.hasNonNull("nodes") || !root.get("nodes").isArray()) {
            throw new IllegalStateException("流程定义缺少 nodes 数组: " + source);
        }
        return root.get("nodes");
    }

    /** 递归展开节点树为扁平执行序列，nodeId 为索引路径（如 "1/0/0"）。 */
    private List<FlatNode> expandNodes(JsonNode nodes, JsonNode formData) {
        List<FlatNode> result = new ArrayList<>();
        expand(nodes, formData, "", result);
        return result;
    }

    private void expand(JsonNode nodes, JsonNode formData, String prefix, List<FlatNode> result) {
        for (int i = 0; i < nodes.size(); i++) {
            JsonNode node = nodes.get(i);
            String nodeId = prefix.isEmpty() ? String.valueOf(i) : prefix + "/" + i;
            String type = node.path("type").asText("");
            switch (type) {
                case "approver" -> result.add(new FlatNode(nodeId, node.path("name").asText("审批"), "approver",
                        node.path("approverType").asText("member"),
                        toStringList(node.path("approvers")),
                        node.path("signMode").asText("or"),
                        List.of(), null));
                case "cc" -> result.add(new FlatNode(nodeId, node.path("name").asText("抄送"), "cc",
                        null, List.of(), null,
                        toStringList(node.path("ccUsers")), null));
                case "condition" -> {
                    JsonNode branch = selectBranch(node, formData);
                    result.add(new FlatNode(nodeId, node.path("name").asText("条件分支"), "condition",
                            null, List.of(), null, List.of(),
                            branch == null ? null : branch.path("name").asText(null)));
                    if (branch != null && branch.path("children").isArray()) {
                        expand(branch.get("children"), formData, nodeId + "/" + branchIndex(node, branch), result);
                    }
                }
                default -> log.warn("未知流程节点类型 type={} nodeId={}，已跳过", type, nodeId);
            }
        }
    }

    private int branchIndex(JsonNode conditionNode, JsonNode selected) {
        JsonNode branches = conditionNode.path("branches");
        for (int i = 0; i < branches.size(); i++) {
            if (branches.get(i) == selected) {
                return i;
            }
        }
        return -1;
    }

    /** 选第一个命中的非默认分支（多条件「且」），否则默认分支。 */
    private JsonNode selectBranch(JsonNode conditionNode, JsonNode formData) {
        JsonNode branches = conditionNode.path("branches");
        JsonNode defaultBranch = null;
        for (JsonNode branch : branches) {
            if (branch.path("isDefault").asBoolean(false)) {
                defaultBranch = branch;
                continue;
            }
            if (conditionsMatch(branch.path("conditions"), formData)) {
                return branch;
            }
        }
        return defaultBranch;
    }

    private boolean conditionsMatch(JsonNode conditions, JsonNode formData) {
        if (!conditions.isArray() || conditions.isEmpty()) {
            return false;
        }
        for (JsonNode condition : conditions) {
            String field = condition.path("field").asText();
            if (!compare(field, formData == null ? null : formData.get(field),
                    condition.path("op").asText("="), condition.path("value"))) {
                return false;
            }
        }
        return true;
    }

    /**
     * &lt; ≤ &gt; ≥ = ≠ 类型感知比较（包级私有 + static，便于单测直接覆盖）：
     * - 两个操作数都能解析为数值（BigDecimal；form_data 里数字 JSON 节点或数字字符串
     *   "5"/5/"5.5" 都算数值）→ 数值比较，支持全部六种操作符（"9" &lt; "10" 为 true）；
     * - 否则 = / ≠ 按字符串精确比较；&lt; ≤ &gt; ≥ 对非数值操作数判不命中并打 warn
     *   （不做字符串大小比较，避免 "abc" &lt; "10" 这类配置错误静默产出错误结果）。
     */
    static boolean compare(String field, JsonNode actual, String op, JsonNode expected) {
        if (actual == null || actual.isNull() || expected == null || expected.isNull()) {
            return false;
        }
        String normalized = normalizeOp(op);
        BigDecimal actualNum = toNumber(actual);
        BigDecimal expectedNum = toNumber(expected);
        if (actualNum != null && expectedNum != null) {
            int cmp = actualNum.compareTo(expectedNum);
            return switch (normalized) {
                case "<" -> cmp < 0;
                case "<=" -> cmp <= 0;
                case ">" -> cmp > 0;
                case ">=" -> cmp >= 0;
                case "!=" -> cmp != 0;
                default -> cmp == 0; // = == eq
            };
        }
        boolean equal = actual.asText().equals(expected.asText());
        if ("=".equals(normalized)) {
            return equal;
        }
        if ("!=".equals(normalized)) {
            return !equal;
        }
        log.warn("条件分支含非数值操作数，不支持 {} 比较，判不命中: field={}, actual={}, expected={}",
                normalized, field, actual.asText(), expected.asText());
        return false;
    }

    private static String normalizeOp(String op) {
        return switch (op.trim()) {
            case "<", "lt" -> "<";
            case "<=", "≤", "lte" -> "<=";
            case ">", "gt" -> ">";
            case ">=", "≥", "gte" -> ">=";
            case "!=", "≠", "ne" -> "!=";
            default -> "=";
        };
    }

    private static BigDecimal toNumber(JsonNode node) {
        try {
            if (node.isNumber()) {
                return node.decimalValue();
            }
            String text = node.asText();
            return (text == null || text.isBlank()) ? null : new BigDecimal(text.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ---------------- 进度序列（审批中心详情） ----------------

    /**
     * 按执行顺序构建完整节点序列：复用 expandNodes 展开（condition 按 form_data 求值，
     * 与推进逻辑同一套代码），节点按流程顺序、节点内动作条目按任务 id（发生顺序）全部展示：
     * - approver 节点：所有非 CANCELED 的已动作任务（APPROVED→DONE、REJECTED→REJECTED，
     *   含加签任务）各出一个条目（带 comment/actedAt，加签条目 nodeName 为
     *   「前加签-XX」/「后加签-XX」）；处理中的加签任务出 CURRENT 条目；节点还有
     *   PENDING/WAITING 普通任务时追加一条 CURRENT 汇总条目（assignees=待处理人）。
     *   多轮动作（同意→驳回→回退重审→再加签）因此全部按序留痕，不再折叠成单一条目。
     * - 节点完全无任务：当前点之前兜底 DONE（assignees 空），之后 PENDING（按配置解析审批人）。
     * - condition 节点：单条 DONE/PENDING + branchName；cc 节点：每条 CC 记录一个条目，
     *   无记录按当前点前后给 CC/PENDING。
     * CANCELED 任务（回退作废）不进进度。实例整体 REJECTED 时当前点锚定到最新 REJECTED
     * 任务所在节点，其后节点显示 PENDING（后端给全量，前端负责截断展示）。
     * 按实例创建时冻结的流程快照展开，在途实例进度不受设计器后续修改影响；
     * 流程不可用（无快照且模板/流程定义被删）时返回 null（容错）。
     */
    public List<ProgressNode> buildProgress(ApprovalInstance instance, List<ApprovalTask> tasks) {
        JsonNode flow;
        try {
            flow = loadInstanceFlow(instance);
        } catch (IllegalStateException e) {
            log.warn("进度序列构建失败，流程不可用: {}", e.getMessage());
            return null;
        }
        List<FlatNode> nodes = expandNodes(flow, parseJson(instance.getFormData()));
        // CANCELED（回退作废）任务不参与进度：被回退节点按新任务重新推导为 CURRENT/PENDING
        Map<String, List<ApprovalTask>> tasksByNode = tasks.stream()
                .filter(t -> !STATUS_CANCELED.equals(t.getStatus()))
                .collect(Collectors.groupingBy(ApprovalTask::getNodeId));

        // 定位当前点：首个有待处理（PENDING）或被挂起（WAITING）任务的节点。
        // REJECTED 不再作为当前点依据：被驳回后重新审批通过的节点，其旧 REJECTED 记录是历史留痕。
        int currentIndex = nodes.size();
        for (int i = 0; i < nodes.size(); i++) {
            List<ApprovalTask> nodeTasks = tasksByNode.get(nodes.get(i).nodeId());
            if (nodeTasks != null && nodeTasks.stream().anyMatch(t ->
                    STATUS_PENDING.equals(t.getStatus()) || STATUS_WAITING.equals(t.getStatus()))) {
                currentIndex = i;
                break;
            }
        }
        // 实例整体被驳回（end）时，锚定到最新一条 REJECTED 任务所在节点，其后节点显示未开始
        if (currentIndex == nodes.size() && STATUS_REJECTED.equals(instance.getStatus())) {
            for (int i = 0; i < nodes.size(); i++) {
                List<ApprovalTask> nodeTasks = tasksByNode.get(nodes.get(i).nodeId());
                if (nodeTasks != null && nodeTasks.stream().anyMatch(t -> STATUS_REJECTED.equals(t.getStatus()))) {
                    currentIndex = i;
                }
            }
        }

        List<ProgressNode> progress = new ArrayList<>();
        for (int i = 0; i < nodes.size(); i++) {
            FlatNode node = nodes.get(i);
            List<ApprovalTask> nodeTasks = tasksByNode.getOrDefault(node.nodeId(), List.of());
            boolean passed = i < currentIndex;
            switch (node.type()) {
                case "condition" -> progress.add(new ProgressNode(node.nodeId(), node.name(), "condition",
                        null, null, null, passed ? "DONE" : "PENDING", null, null, node.branchName()));
                case "cc" -> progress.addAll(buildCcProgress(node, nodeTasks, passed));
                default -> progress.addAll(buildApproverProgress(node, nodeTasks, passed));
            }
        }
        return progress;
    }

    /**
     * approver 节点的进度条目，按任务 id（发生顺序）展开：
     * 已动作任务（APPROVED/REJECTED，含加签）各一条 DONE/REJECTED；处理中的加签任务
     * 一条 CURRENT；普通待办/挂起任务汇总为一条 CURRENT（按 id 首次出现的位置插入）。
     * 节点完全无任务时按当前点前后给 DONE（兜底）/PENDING（解析审批人）。
     */
    private List<ProgressNode> buildApproverProgress(FlatNode node, List<ApprovalTask> nodeTasks, boolean passed) {
        List<ProgressNode> entries = new ArrayList<>();
        List<String> currentAssignees = new ArrayList<>(); // 普通 PENDING/WAITING 任务的待处理人（去重保序）
        for (ApprovalTask t : nodeTasks.stream()
                .sorted(Comparator.comparing(ApprovalTask::getId)).toList()) {
            boolean acted = STATUS_APPROVED.equals(t.getStatus()) || STATUS_REJECTED.equals(t.getStatus());
            if (!acted && isNormal(t)) {
                if (!currentAssignees.contains(t.getAssigneeName())) {
                    currentAssignees.add(t.getAssigneeName());
                }
                continue;
            }
            flushCurrentEntry(entries, node, currentAssignees);
            entries.add(buildTaskEntry(node, t));
        }
        flushCurrentEntry(entries, node, currentAssignees);
        if (entries.isEmpty()) {
            List<String> assignees = passed ? List.of() : resolveAssignees(node);
            entries.add(new ProgressNode(node.nodeId(), node.name(), "approver", ORIGIN_NORMAL, node.signMode(),
                    assignees, passed ? "DONE" : "PENDING", null, null, null));
        }
        return entries;
    }

    /** 普通待办/挂起任务汇总为一条 CURRENT 条目，插入到首个待办任务的位置。 */
    private void flushCurrentEntry(List<ProgressNode> entries, FlatNode node, List<String> currentAssignees) {
        if (currentAssignees.isEmpty()) {
            return;
        }
        entries.add(new ProgressNode(node.nodeId(), node.name(), "approver", ORIGIN_NORMAL, node.signMode(),
                List.copyOf(currentAssignees), "CURRENT", null, null, null));
        currentAssignees.clear();
    }

    /** 单个任务的动作条目：APPROVED→DONE、REJECTED→REJECTED、处理中加签→CURRENT。加签条目名为「前加签-XX」/「后加签-XX」。 */
    private ProgressNode buildTaskEntry(FlatNode node, ApprovalTask task) {
        boolean addSign = !isNormal(task);
        String name = addSign
                ? (ORIGIN_ADD_BEFORE.equals(task.getOrigin()) ? "前加签-" : "后加签-") + task.getAssigneeName()
                : node.name();
        boolean acted = STATUS_APPROVED.equals(task.getStatus()) || STATUS_REJECTED.equals(task.getStatus());
        String status = switch (task.getStatus()) {
            case STATUS_APPROVED -> "DONE";
            case STATUS_REJECTED -> STATUS_REJECTED;
            default -> "CURRENT";
        };
        return new ProgressNode(task.getNodeId(), name, "approver",
                addSign ? task.getOrigin() : ORIGIN_NORMAL, addSign ? null : node.signMode(),
                List.of(task.getAssigneeName()), status,
                acted ? task.getComment() : null, acted ? task.getActedAt() : null, null);
    }

    /** cc 节点：每条 CC 记录一个条目；无记录时当前点之前兜底 CC、之后 PENDING（按配置解析抄送人）。 */
    private List<ProgressNode> buildCcProgress(FlatNode node, List<ApprovalTask> nodeTasks, boolean passed) {
        if (!nodeTasks.isEmpty()) {
            return nodeTasks.stream().sorted(Comparator.comparing(ApprovalTask::getId))
                    .map(t -> new ProgressNode(t.getNodeId(), node.name(), "cc", null, null,
                            List.of(t.getAssigneeName()), STATUS_CC, null, t.getActedAt(), null))
                    .toList();
        }
        List<String> assignees = passed ? List.of() : node.ccUsers();
        return List.of(new ProgressNode(node.nodeId(), node.name(), "cc", null, null,
                assignees, passed ? STATUS_CC : "PENDING", null, null, null));
    }

    // ---------------- 审批人解析 ----------------

    private List<String> resolveAssignees(FlatNode node) {
        List<String> result = new ArrayList<>();
        switch (node.approverType()) {
            case "role" -> {
                // 角色审批人：全库按角色编码解析在职用户
                for (String roleCode : node.approvers()) {
                    result.addAll(userRepository.findRealNamesByRoleCode(roleCode));
                }
            }
            case "deptLeader" -> {
                // 部门负责人：sys_dept 暂无 leader 字段，本期取部门全部在职人员，待组织架构完善后改为 leader
                for (String approver : node.approvers()) {
                    try {
                        userRepository.findByDeptId(Long.parseLong(approver.trim())).stream()
                                .filter(u -> u.getStatus() != null && u.getStatus() == 1)
                                .map(SysUser::getRealName)
                                .forEach(result::add);
                    } catch (NumberFormatException e) {
                        log.warn("deptLeader 审批人不是部门ID: {}", approver);
                    }
                }
            }
            default -> result.addAll(node.approvers()); // member：直接按姓名
        }
        return result.stream().filter(s -> s != null && !s.isBlank()).distinct().toList();
    }

    // ---------------- 工具 ----------------

    private ApprovalTask loadPendingTask(Long taskId) {
        ApprovalTask task = taskRepository.findById(taskId)
                .orElseThrow(() -> new IllegalArgumentException("审批任务不存在: " + taskId));
        if (!STATUS_PENDING.equals(task.getStatus())) {
            throw new IllegalStateException("任务已处理: " + taskId);
        }
        return task;
    }

    private ApprovalInstance loadPendingInstance(Long instanceId) {
        ApprovalInstance instance = instanceRepository.findById(instanceId)
                .orElseThrow(() -> new IllegalStateException("审批实例不存在: " + instanceId));
        if (!STATUS_PENDING.equals(instance.getStatus())) {
            throw new IllegalStateException("实例已结束: " + instanceId);
        }
        return instance;
    }

    private List<String> toStringList(JsonNode array) {
        List<String> list = new ArrayList<>();
        if (array != null && array.isArray()) {
            array.forEach(item -> list.add(item.asText()));
        }
        return list;
    }

    private JsonNode parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException("JSON 解析失败", e);
        }
    }
}
