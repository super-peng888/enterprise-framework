package com.framework.system.controller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.framework.common.annotation.AuditLog;
import com.framework.common.error.ErrorCode;
import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.dto.ActRequest;
import com.framework.system.dto.AddSignRequest;
import com.framework.system.dto.CreateInstanceRequest;
import com.framework.system.dto.ResubmitRequest;
import com.framework.system.entity.ApprovalInstance;
import com.framework.system.entity.ApprovalTask;
import com.framework.system.entity.ApprovalTemplate;
import com.framework.system.entity.FormDefinition;
import com.framework.system.entity.SysUser;
import com.framework.system.repository.ApprovalInstanceRepository;
import com.framework.system.repository.ApprovalTaskRepository;
import com.framework.system.repository.ApprovalTemplateRepository;
import com.framework.system.repository.FormDefinitionRepository;
import com.framework.system.security.LoginUser;
import com.framework.system.repository.SysUserRepository;
import com.framework.system.service.ApprovalEngineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 审批实例与任务。
 */
@Slf4j
@RestController
@RequestMapping("/approval")
@RequiredArgsConstructor
public class ApprovalInstanceController {

    private final ApprovalEngineService approvalEngine;
    private final ApprovalInstanceRepository instanceRepository;
    private final ApprovalTaskRepository taskRepository;
    private final ApprovalTemplateRepository templateRepository;
    private final FormDefinitionRepository formDefinitionRepository;
    private final SysUserRepository userRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 发起审批：创建实例 + 生成首个节点任务。
     */
    @PostMapping("/instances")
    @AuditLog(module = "approval", action = "发起审批")
    public Result<ApprovalInstance> create(@Valid @RequestBody CreateInstanceRequest req,
                                           @AuthenticationPrincipal LoginUser loginUser) {
        Long initiatorId = loginUser == null ? null : loginUser.id();
        String initiatorName = req.getInitiatorName();
        if (loginUser != null) {
            initiatorName = userRepository.findById(loginUser.id())
                    .map(SysUser::getRealName).orElse(loginUser.username());
        }
        return Result.ok(approvalEngine.createInstance(req.getTemplateCode(), req.getBusinessKey(),
                req.getTitle(), req.getFormData(), initiatorId, initiatorName));
    }

    /**
     * 待办：某审批人名下 PENDING 任务（实例仍在审批中）。
     */
    @GetMapping("/instances/todo")
    public Result<PageResult<Map<String, Object>>> todo(@RequestParam(name = "assignee") String assignee,
                                                        @RequestParam(name = "page", defaultValue = "1") int page,
                                                        @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<ApprovalTask> data = taskRepository.findTodo(assignee,
                PageRequest.of(Math.max(page - 1, 0), size));
        return Result.ok(PageResult.of(enrich(data.getContent()), data.getTotalElements(), page, size));
    }

    /**
     * 已办：某审批人处理过（通过/驳回）的任务。
     */
    @GetMapping("/instances/done")
    public Result<PageResult<Map<String, Object>>> done(@RequestParam(name = "assignee") String assignee,
                                                        @RequestParam(name = "page", defaultValue = "1") int page,
                                                        @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<ApprovalTask> data = taskRepository.findDone(assignee,
                PageRequest.of(Math.max(page - 1, 0), size));
        return Result.ok(PageResult.of(enrich(data.getContent()), data.getTotalElements(), page, size));
    }

    /**
     * 我发起的实例。
     */
    @GetMapping("/instances/mine")
    public Result<PageResult<ApprovalInstance>> mine(@RequestParam(name = "initiator") String initiator,
                                                     @RequestParam(name = "page", defaultValue = "1") int page,
                                                     @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<ApprovalInstance> data = instanceRepository.findByInitiatorNameOrderByIdDesc(initiator,
                PageRequest.of(Math.max(page - 1, 0), size));
        return Result.ok(PageResult.of(data.getContent(), data.getTotalElements(), page, size));
    }

    /**
     * 抄送我的：cc 节点生成的抄送记录（nodeType=cc 且 status=CC），
     * 视图包裹结构与待办/已办一致，按任务 id 倒序分页。
     */
    @GetMapping("/instances/cc")
    public Result<PageResult<Map<String, Object>>> cc(@RequestParam(name = "assignee") String assignee,
                                                      @RequestParam(name = "page", defaultValue = "1") int page,
                                                      @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<ApprovalTask> data = taskRepository.findCc(assignee,
                PageRequest.of(Math.max(page - 1, 0), size));
        return Result.ok(PageResult.of(enrich(data.getContent()), data.getTotalElements(), page, size));
    }

    /**
     * 实例详情：实例 + tasks 列表 + 当前节点 + 模板/表单 schema/进度序列（审批中心）。
     */
    @GetMapping("/instances/{id}")
    public Result<Map<String, Object>> detail(@PathVariable("id") Long id) {
        ApprovalInstance instance = instanceRepository.findById(id).orElse(null);
        if (instance == null) {
            return Result.fail(404, "审批实例不存在");
        }
        List<ApprovalTask> tasks = taskRepository.findByInstanceIdOrderBySortAscIdAsc(id);
        ApprovalTemplate template = instance.getTemplateId() == null ? null
                : templateRepository.findById(instance.getTemplateId()).orElse(null);

        Map<String, Object> result = new HashMap<>();
        result.put("instance", instance);
        result.put("tasks", tasks);
        result.put("currentNode", instance.getCurrentNodePath());
        // 模板/表单被删时 template/formSchema 为 null（容错）
        result.put("template", template == null ? null : templateSummary(template));
        result.put("formSchema", loadFormSchema(instance, template));
        result.put("progress", approvalEngine.buildProgress(instance, tasks));
        return Result.ok(result);
    }

    private Map<String, Object> templateSummary(ApprovalTemplate template) {
        Map<String, Object> summary = new HashMap<>();
        summary.put("id", template.getId());
        summary.put("code", template.getCode());
        summary.put("name", template.getName());
        return summary;
    }

    /** 表单 schema 解析为 JSON 对象返回（不是字符串）。优先读实例创建时冻结的 form_snapshot
     *  （表单版本快照，设计器后续修改不影响在途实例）；快照为空的存量实例回退读模板当前
     *  表单定义并打 warn（与 flow 快照的兼容策略一致）；模板/表单缺失或解析失败时为 null。 */
    private JsonNode loadFormSchema(ApprovalInstance instance, ApprovalTemplate template) {
        String snapshot = instance.getFormSnapshot();
        if (snapshot != null && !snapshot.isBlank()) {
            try {
                return objectMapper.readTree(snapshot);
            } catch (Exception e) {
                log.warn("表单快照解析失败，instanceId={}: {}", instance.getId(), e.getMessage());
                return null;
            }
        }
        if (template == null || template.getFormId() == null) {
            return null;
        }
        log.warn("实例无表单快照，回退读模板当前表单定义: instanceId={}", instance.getId());
        String schema = formDefinitionRepository.findById(template.getFormId())
                .map(FormDefinition::getSchema).orElse(null);
        if (schema == null || schema.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(schema);
        } catch (Exception e) {
            log.warn("表单 schema 解析失败，formId={}: {}", template.getFormId(), e.getMessage());
            return null;
        }
    }

    @PostMapping("/tasks/{id}/approve")
    @AuditLog(module = "approval", action = "审批通过")
    public Result<ApprovalInstance> approve(@PathVariable("id") Long id, @RequestBody(required = false) ActRequest req) {
        return Result.ok(approvalEngine.approve(id, req == null ? null : req.getComment(),
                req == null ? null : req.getFormData()));
    }

    /**
     * 驳回。targetType 缺省/end 为整体驳回（实例 REJECTED + 发 approval.finished）；
     * prev/node 驳回到当前节点之前的审批节点（node 需带 targetNodeId），实例保持 PENDING；
     * initiator 退回发起人（实例 RETURNED，等重新提交）。comment 必填。
     */
    @PostMapping("/tasks/{id}/reject")
    @AuditLog(module = "approval", action = "审批驳回")
    public Result<ApprovalInstance> reject(@PathVariable("id") Long id, @RequestBody(required = false) ActRequest req) {
        return Result.ok(approvalEngine.reject(id, req == null ? null : req.getComment(),
                req == null ? null : req.getTargetType(), req == null ? null : req.getTargetNodeId()));
    }

    /**
     * 重新提交：仅实例发起人本人（JWT realName 匹配 initiatorName）且实例为 RETURNED。
     * formData 传了则覆盖实例 form_data（条件分支重新求值），从流程起点重新展开。
     */
    @PostMapping("/instances/{id}/resubmit")
    @AuditLog(module = "approval", action = "重新提交审批")
    public Result<ApprovalInstance> resubmit(@PathVariable("id") Long id,
                                             @RequestBody(required = false) ResubmitRequest req,
                                             @AuthenticationPrincipal LoginUser loginUser) {
        if (loginUser == null) {
            return Result.fail(ErrorCode.UNAUTHORIZED.getCode(), "未登录");
        }
        String operator = userRepository.findById(loginUser.id())
                .map(SysUser::getRealName).orElse(loginUser.username());
        return Result.ok(approvalEngine.resubmit(id, req == null ? null : req.getFormData(), operator));
    }

    /**
     * 加签：仅任务当前处理人本人可操作，操作人取当前 JWT 用户 realName。
     * position=before 前加签（原任务挂起）/ after 后加签（原任务视为通过，加签人继续审）。
     */
    @PostMapping("/tasks/{id}/add-sign")
    @AuditLog(module = "approval", action = "审批加签")
    public Result<ApprovalTask> addSign(@PathVariable("id") Long id,
                                        @Valid @RequestBody AddSignRequest req,
                                        @AuthenticationPrincipal LoginUser loginUser) {
        if (loginUser == null) {
            return Result.fail(ErrorCode.UNAUTHORIZED.getCode(), "未登录");
        }
        String operator = userRepository.findById(loginUser.id())
                .map(SysUser::getRealName).orElse(loginUser.username());
        return Result.ok(approvalEngine.addSign(id, req.getPosition(), req.getAssignee(),
                req.getComment(), operator));
    }

    /** 任务列表补充实例标题/业务键/模板编码，便于审批中心展示。 */
    private List<Map<String, Object>> enrich(List<ApprovalTask> tasks) {
        return tasks.stream().map(task -> {
            Map<String, Object> row = new HashMap<>();
            row.put("task", task);
            instanceRepository.findById(task.getInstanceId()).ifPresent(instance -> {
                row.put("instanceTitle", instance.getTitle());
                row.put("businessKey", instance.getBusinessKey());
                row.put("instanceStatus", instance.getStatus());
                row.put("formData", instance.getFormData());
                row.put("initiatorName", instance.getInitiatorName());
                row.put("instanceCreatedAt", instance.getCreatedAt());
                templateRepository.findById(instance.getTemplateId())
                        .ifPresent(t -> row.put("templateCode", t.getCode()));
            });
            return row;
        }).toList();
    }
}
