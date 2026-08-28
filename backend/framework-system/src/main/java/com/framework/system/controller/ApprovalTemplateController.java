package com.framework.system.controller;

import com.framework.common.annotation.AuditLog;
import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.entity.ApprovalTemplate;
import com.framework.system.repository.ApprovalTemplateRepository;
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
 * 审批模板 CRUD（绑定表单 + 流程）。
 */
@RestController
@RequestMapping("/approval/templates")
@RequiredArgsConstructor
public class ApprovalTemplateController {

    private final ApprovalTemplateRepository templateRepository;

    @GetMapping
    public Result<PageResult<ApprovalTemplate>> page(@RequestParam(name = "page", defaultValue = "1") int page,
                                                     @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<ApprovalTemplate> data = templateRepository.findAll(
                PageRequest.of(Math.max(page - 1, 0), size, Sort.by("id")));
        return Result.ok(PageResult.of(data.getContent(), data.getTotalElements(), page, size));
    }

    @GetMapping("/{id}")
    public Result<ApprovalTemplate> get(@PathVariable("id") Long id) {
        return templateRepository.findById(id).map(Result::ok).orElse(Result.fail(404, "模板不存在"));
    }

    @PostMapping
    @AuditLog(module = "approval", action = "新增模板")
    public Result<ApprovalTemplate> create(@RequestBody ApprovalTemplate template) {
        template.setId(null);
        template.setUpdatedAt(LocalDateTime.now());
        return Result.ok(templateRepository.save(template));
    }

    @PutMapping("/{id}")
    @AuditLog(module = "approval", action = "修改模板")
    public Result<ApprovalTemplate> update(@PathVariable("id") Long id, @RequestBody ApprovalTemplate template) {
        if (!templateRepository.existsById(id)) {
            return Result.fail(404, "模板不存在");
        }
        template.setId(id);
        template.setUpdatedAt(LocalDateTime.now());
        return Result.ok(templateRepository.save(template));
    }

    @DeleteMapping("/{id}")
    @AuditLog(module = "approval", action = "删除模板")
    public Result<Void> delete(@PathVariable("id") Long id) {
        if (!templateRepository.existsById(id)) {
            return Result.fail(404, "模板不存在");
        }
        templateRepository.deleteById(id);
        return Result.ok();
    }
}
