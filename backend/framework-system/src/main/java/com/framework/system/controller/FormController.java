package com.framework.system.controller;

import com.framework.common.annotation.AuditLog;
import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.entity.FormDefinition;
import com.framework.system.repository.FormDefinitionRepository;
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
 * 动态表单定义 CRUD。
 */
@RestController
@RequestMapping("/forms")
@RequiredArgsConstructor
public class FormController {

    private final FormDefinitionRepository formRepository;

    @GetMapping
    public Result<PageResult<FormDefinition>> page(@RequestParam(name = "page", defaultValue = "1") int page,
                                                   @RequestParam(name = "size", defaultValue = "10") int size) {
        Page<FormDefinition> data = formRepository.findAll(
                PageRequest.of(Math.max(page - 1, 0), size, Sort.by("id")));
        return Result.ok(PageResult.of(data.getContent(), data.getTotalElements(), page, size));
    }

    @GetMapping("/{id}")
    public Result<FormDefinition> get(@PathVariable("id") Long id) {
        return formRepository.findById(id).map(Result::ok).orElse(Result.fail(404, "表单不存在"));
    }

    /** 按 code 查启用状态的表单（code 全局唯一，如 LEAVE_APPLY）。 */
    @GetMapping("/code/{code}")
    public Result<FormDefinition> getByCode(@PathVariable("code") String code) {
        return formRepository.findByCodeAndStatus(code, "启用")
                .map(Result::ok)
                .orElse(Result.fail(404, "表单不存在或已停用"));
    }

    @PostMapping
    @AuditLog(module = "approval", action = "新增表单")
    public Result<FormDefinition> create(@RequestBody FormDefinition form) {
        form.setId(null);
        form.setUpdatedAt(LocalDateTime.now());
        return Result.ok(formRepository.save(form));
    }

    @PutMapping("/{id}")
    @AuditLog(module = "approval", action = "修改表单")
    public Result<FormDefinition> update(@PathVariable("id") Long id, @RequestBody FormDefinition form) {
        if (!formRepository.existsById(id)) {
            return Result.fail(404, "表单不存在");
        }
        form.setId(id);
        form.setUpdatedAt(LocalDateTime.now());
        return Result.ok(formRepository.save(form));
    }

    @DeleteMapping("/{id}")
    @AuditLog(module = "approval", action = "删除表单")
    public Result<Void> delete(@PathVariable("id") Long id) {
        if (!formRepository.existsById(id)) {
            return Result.fail(404, "表单不存在");
        }
        formRepository.deleteById(id);
        return Result.ok();
    }
}
