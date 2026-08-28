package com.framework.system.controller;

import com.framework.common.annotation.AuditLog;
import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.entity.SysRole;
import com.framework.system.entity.SysRoleMenu;
import com.framework.system.repository.SysRoleMenuRepository;
import com.framework.system.repository.SysRoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 角色管理 CRUD。
 */
@RestController
@RequestMapping("/roles")
@RequiredArgsConstructor
public class RoleController {

    private final SysRoleRepository roleRepository;
    private final SysRoleMenuRepository roleMenuRepository;

    @GetMapping
    public Result<PageResult<SysRole>> page(@RequestParam(defaultValue = "1") int pageNum,
                                            @RequestParam(defaultValue = "10") int pageSize) {
        Page<SysRole> page = roleRepository.findAll(
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by("id")));
        return Result.ok(PageResult.of(page.getContent(), page.getTotalElements(), pageNum, pageSize));
    }

    @GetMapping("/{id}")
    public Result<SysRole> get(@PathVariable Long id) {
        return roleRepository.findById(id).map(Result::ok).orElse(Result.fail(404, "角色不存在"));
    }

    @PostMapping
    @AuditLog(module = "system-role", action = "新增角色")
    public Result<SysRole> create(@RequestBody SysRole role) {
        role.setId(null);
        return Result.ok(roleRepository.save(role));
    }

    @PutMapping("/{id}")
    @AuditLog(module = "system-role", action = "修改角色")
    public Result<SysRole> update(@PathVariable Long id, @RequestBody SysRole role) {
        if (!roleRepository.existsById(id)) {
            return Result.fail(404, "角色不存在");
        }
        role.setId(id);
        return Result.ok(roleRepository.save(role));
    }

    @DeleteMapping("/{id}")
    @AuditLog(module = "system-role", action = "删除角色")
    @Transactional
    public Result<Void> delete(@PathVariable Long id) {
        if (!roleRepository.existsById(id)) {
            return Result.fail(404, "角色不存在");
        }
        roleMenuRepository.deleteByRoleId(id);
        roleRepository.deleteById(id);
        return Result.ok();
    }

    /**
     * 分配菜单/权限点（全量覆盖）。
     */
    @PostMapping("/{id}/menus")
    @AuditLog(module = "system-role", action = "分配菜单")
    @Transactional
    public Result<Void> assignMenus(@PathVariable Long id, @RequestBody List<Long> menuIds) {
        if (!roleRepository.existsById(id)) {
            return Result.fail(404, "角色不存在");
        }
        roleMenuRepository.deleteByRoleId(id);
        if (menuIds != null) {
            menuIds.forEach(menuId -> roleMenuRepository.save(new SysRoleMenu(id, menuId)));
        }
        return Result.ok();
    }
}
