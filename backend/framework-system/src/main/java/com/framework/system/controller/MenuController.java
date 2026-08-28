package com.framework.system.controller;

import com.framework.common.annotation.AuditLog;
import com.framework.common.result.Result;
import com.framework.system.entity.SysMenu;
import com.framework.system.repository.SysMenuRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 菜单/权限点管理。菜单层级浅（目录-菜单-按钮），直接返回平铺列表由前端组树。
 */
@RestController
@RequestMapping("/menus")
@RequiredArgsConstructor
public class MenuController {

    private final SysMenuRepository menuRepository;

    @GetMapping
    public Result<List<SysMenu>> list() {
        return Result.ok(menuRepository.findAll(Sort.by("sort", "id")));
    }

    @GetMapping("/{id}")
    public Result<SysMenu> get(@PathVariable Long id) {
        return menuRepository.findById(id).map(Result::ok).orElse(Result.fail(404, "菜单不存在"));
    }

    @PostMapping
    @AuditLog(module = "system-menu", action = "新增菜单")
    public Result<SysMenu> create(@RequestBody SysMenu menu) {
        menu.setId(null);
        return Result.ok(menuRepository.save(menu));
    }

    @PutMapping("/{id}")
    @AuditLog(module = "system-menu", action = "修改菜单")
    public Result<SysMenu> update(@PathVariable Long id, @RequestBody SysMenu menu) {
        if (!menuRepository.existsById(id)) {
            return Result.fail(404, "菜单不存在");
        }
        menu.setId(id);
        return Result.ok(menuRepository.save(menu));
    }

    @DeleteMapping("/{id}")
    @AuditLog(module = "system-menu", action = "删除菜单")
    public Result<Void> delete(@PathVariable Long id) {
        if (!menuRepository.existsById(id)) {
            return Result.fail(404, "菜单不存在");
        }
        menuRepository.deleteById(id);
        return Result.ok();
    }
}
