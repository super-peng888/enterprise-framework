package com.framework.system.controller;

import com.framework.common.annotation.AuditLog;
import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.entity.ApprovalTemplate;
import com.framework.system.entity.FlowDefinition;
import com.framework.system.repository.ApprovalTemplateRepository;
import com.framework.system.repository.FlowDefinitionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;

/**
 * 流程定义 CRUD（树形 JSON 流程）。
 */
@RestController
@RequestMapping("/flows")
@RequiredArgsConstructor
public class FlowController {

    private final FlowDefinitionRepository flowRepository;
    private final ApprovalTemplateRepository templateRepository;

    /**
     * 保存流程后，若关联了表单则自动维护审批模板（code=FLOW_{id}，名称同流程名），
     * 让「流程设计器里配的流程+表单」直接可在发起审批中使用，无需手工建模板。
     */
    private void syncTemplate(FlowDefinition flow) {
        if (flow.getFormId() == null) {
            return;
        }
        ApprovalTemplate tpl = templateRepository.findByCode("FLOW_" + flow.getId())
                .orElseGet(ApprovalTemplate::new);
        tpl.setCode("FLOW_" + flow.getId());
        tpl.setName(flow.getName());
        tpl.setFormId(flow.getFormId());
        tpl.setFlowId(flow.getId());
        if (tpl.getStatus() == null) {
            tpl.setStatus("启用");
        }
        tpl.setUpdatedAt(LocalDateTime.now());
        templateRepository.save(tpl);
    }

    @GetMapping
    public Result<PageResult<FlowDefinition>> page(@RequestParam(name = "page", defaultValue = "1") int page,
                                                   @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<FlowDefinition> data = flowRepository.findAll(
                PageRequest.of(Math.max(page - 1, 0), size, Sort.by("id")));
        return Result.ok(PageResult.of(data.getContent(), data.getTotalElements(), page, size));
    }

    @GetMapping("/{id}")
    public Result<FlowDefinition> get(@PathVariable("id") Long id) {
        return flowRepository.findById(id).map(Result::ok).orElse(Result.fail(404, "流程不存在"));
    }

    @PostMapping
    @AuditLog(module = "approval", action = "新增流程")
    public Result<FlowDefinition> create(@RequestBody FlowDefinition flow) {
        flow.setId(null);
        flow.setUpdatedAt(LocalDateTime.now());
        FlowDefinition saved = flowRepository.save(flow);
        syncTemplate(saved);
        return Result.ok(saved);
    }

    @PutMapping("/{id}")
    @AuditLog(module = "approval", action = "修改流程")
    public Result<FlowDefinition> update(@PathVariable("id") Long id, @RequestBody FlowDefinition flow) {
        FlowDefinition existing = flowRepository.findById(id).orElse(null);
        if (existing == null) {
            return Result.fail(404, "流程不存在");
        }
        flow.setId(id);
        flow.setUpdatedAt(LocalDateTime.now());
        // 部分更新语义：前端设计器保存只传 name/flowJson/formId，status 为空时保留原值，避免整实体覆盖写空
        if (flow.getStatus() == null) {
            flow.setStatus(existing.getStatus());
        }
        FlowDefinition saved = flowRepository.save(flow);
        syncTemplate(saved);
        return Result.ok(saved);
    }

    @DeleteMapping("/{id}")
    @AuditLog(module = "approval", action = "删除流程")
    public Result<Void> delete(@PathVariable("id") Long id) {
        if (!flowRepository.existsById(id)) {
            return Result.fail(404, "流程不存在");
        }
        flowRepository.deleteById(id);
        return Result.ok();
    }
}
