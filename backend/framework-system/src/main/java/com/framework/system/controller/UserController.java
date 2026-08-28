package com.framework.system.controller;

import com.framework.common.annotation.AuditLog;
import com.framework.common.annotation.DataScope;
import com.framework.common.context.DataScopeContext;
import com.framework.common.context.DataScopeInfo;
import com.framework.common.result.PageResult;
import com.framework.common.result.Result;
import com.framework.system.entity.SysUser;
import com.framework.system.entity.SysUserRole;
import com.framework.system.repository.SysUserRepository;
import com.framework.system.repository.SysUserRoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
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
 * 用户管理 CRUD。
 */
@RestController
@RequestMapping("/users")
@RequiredArgsConstructor
public class UserController {

    private final SysUserRepository userRepository;
    private final SysUserRoleRepository userRoleRepository;

    /**
     * 用户列表：叠加 @DataScope 解析出的数据范围（SELF 只看自己 / DEPT 本部门 /
     * DEPT_AND_CHILD 本部门及以下 / CUSTOM 指定部门 / ALL 全部）。
     */
    @GetMapping
    @DataScope(ownerField = "id", deptField = "deptId")
    public Result<PageResult<SysUser>> page(@RequestParam(defaultValue = "1") int pageNum,
                                            @RequestParam(defaultValue = "10") int pageSize) {
        Page<SysUser> page = userRepository.findAll(dataScopeSpec(),
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by("id")));
        return Result.ok(PageResult.of(page.getContent(), page.getTotalElements(), pageNum, pageSize));
    }

    /** 数据范围条件：sys_user 的归属人即自身 id，归属部门即 deptId。 */
    private Specification<SysUser> dataScopeSpec() {
        DataScopeInfo scope = DataScopeContext.get();
        if (scope == null || scope.type() == DataScopeInfo.ScopeType.ALL) {
            return null;
        }
        return (root, query, cb) -> {
            if (scope.type() == DataScopeInfo.ScopeType.SELF) {
                return cb.equal(root.get("id"), scope.userId());
            }
            if (scope.deptIds().isEmpty()) {
                return cb.disjunction(); // 无部门归属（如未分配部门）时看不到任何人
            }
            return root.get("deptId").in(scope.deptIds());
        };
    }

    @GetMapping("/{id}")
    public Result<SysUser> get(@PathVariable Long id) {
        return userRepository.findById(id).map(Result::ok).orElse(Result.fail(404, "用户不存在"));
    }

    @PostMapping
    @AuditLog(module = "system-user", action = "新增用户")
    public Result<SysUser> create(@RequestBody SysUser user) {
        user.setId(null);
        return Result.ok(userRepository.save(user));
    }

    @PutMapping("/{id}")
    @AuditLog(module = "system-user", action = "修改用户")
    public Result<SysUser> update(@PathVariable Long id, @RequestBody SysUser user) {
        if (!userRepository.existsById(id)) {
            return Result.fail(404, "用户不存在");
        }
        user.setId(id);
        return Result.ok(userRepository.save(user));
    }

    @DeleteMapping("/{id}")
    @AuditLog(module = "system-user", action = "删除用户")
    @Transactional
    public Result<Void> delete(@PathVariable Long id) {
        if (!userRepository.existsById(id)) {
            return Result.fail(404, "用户不存在");
        }
        userRoleRepository.deleteByUserId(id);
        userRepository.deleteById(id);
        return Result.ok();
    }

    /**
     * 分配角色（全量覆盖）。
     */
    @PostMapping("/{id}/roles")
    @AuditLog(module = "system-user", action = "分配角色")
    @Transactional
    public Result<Void> assignRoles(@PathVariable Long id, @RequestBody List<Long> roleIds) {
        if (!userRepository.existsById(id)) {
            return Result.fail(404, "用户不存在");
        }
        userRoleRepository.deleteByUserId(id);
        if (roleIds != null) {
            roleIds.forEach(roleId -> userRoleRepository.save(new SysUserRole(id, roleId)));
        }
        return Result.ok();
    }
}
