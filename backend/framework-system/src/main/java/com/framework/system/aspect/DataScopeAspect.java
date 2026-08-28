package com.framework.system.aspect;

import com.framework.common.annotation.DataScope;
import com.framework.common.context.DataScopeContext;
import com.framework.common.context.DataScopeInfo;
import com.framework.system.entity.SysDept;
import com.framework.system.entity.SysRole;
import com.framework.system.entity.SysUser;
import com.framework.system.repository.SysDeptRepository;
import com.framework.system.repository.SysRoleRepository;
import com.framework.system.repository.SysUserRepository;
import com.framework.system.security.LoginUser;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 数据权限切面：拦截 @DataScope 标注的方法，解析当前用户所有角色 data_scope
 * 的最宽档（ALL(1) &gt; DEPT_AND_CHILD(2) &gt; DEPT(3) &gt; SELF(4) &gt; CUSTOM(5)），
 * 结果写入 DataScopeContext 供业务查询叠加；方法结束 remove。
 *
 * DEPT 本部门 / DEPT_AND_CHILD 本部门及以下（部门树递归）/ CUSTOM 自定义部门集合
 * （角色 dept_ids 并集）解析为部门 ID 集合；SELF 解析为当前用户 ID；ALL 不限制。
 */
@Aspect
@Component
@RequiredArgsConstructor
public class DataScopeAspect {

    private final SysRoleRepository roleRepository;
    private final SysUserRepository userRepository;
    private final SysDeptRepository deptRepository;

    @Around("@annotation(dataScope)")
    public Object around(ProceedingJoinPoint pjp, DataScope dataScope) throws Throwable {
        try {
            DataScopeContext.set(resolve());
            return pjp.proceed();
        } finally {
            DataScopeContext.remove();
        }
    }

    private DataScopeInfo resolve() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof LoginUser loginUser)) {
            return DataScopeInfo.all(); // 无登录态（内调等）不限制
        }
        List<SysRole> roles = roleRepository.findRolesByUserId(loginUser.id());
        if (roles.isEmpty()) {
            return DataScopeInfo.self(loginUser.id());
        }
        SysRole widest = roles.stream()
                .min((a, b) -> Integer.compare(rank(a.getDataScope()), rank(b.getDataScope())))
                .orElseThrow();
        return switch (Objects.requireNonNullElse(widest.getDataScope(), "SELF")) {
            case "ALL" -> DataScopeInfo.all();
            case "DEPT" -> DataScopeInfo.depts(DataScopeInfo.ScopeType.DEPT, ownDept(loginUser.id()));
            case "DEPT_AND_CHILD" ->
                    DataScopeInfo.depts(DataScopeInfo.ScopeType.DEPT_AND_CHILD, ownDeptAndChildren(loginUser.id()));
            case "CUSTOM" -> DataScopeInfo.depts(DataScopeInfo.ScopeType.CUSTOM, customDepts(roles));
            default -> DataScopeInfo.self(loginUser.id());
        };
    }

    /** 档位权重：数字越小越宽。未知值按 SELF 兜底。 */
    private int rank(String dataScope) {
        return switch (Objects.requireNonNullElse(dataScope, "SELF")) {
            case "ALL" -> 1;
            case "DEPT_AND_CHILD" -> 2;
            case "DEPT" -> 3;
            case "CUSTOM" -> 5;
            default -> 4; // SELF
        };
    }

    private Set<Long> ownDept(Long userId) {
        SysUser user = userRepository.findById(userId).orElse(null);
        return user != null && user.getDeptId() != null ? Set.of(user.getDeptId()) : Set.of();
    }

    /** 本部门及以下：以 parent_id 递归向下收集。 */
    private Set<Long> ownDeptAndChildren(Long userId) {
        Set<Long> roots = ownDept(userId);
        if (roots.isEmpty()) {
            return roots;
        }
        Map<Long, List<Long>> childrenMap = new HashMap<>();
        for (SysDept dept : deptRepository.findAll()) {
            if (dept.getParentId() != null) {
                childrenMap.computeIfAbsent(dept.getParentId(), k -> new java.util.ArrayList<>()).add(dept.getId());
            }
        }
        Set<Long> result = new HashSet<>(roots);
        Deque<Long> queue = new ArrayDeque<>(roots);
        while (!queue.isEmpty()) {
            Long current = queue.poll();
            for (Long child : childrenMap.getOrDefault(current, List.of())) {
                if (result.add(child)) {
                    queue.offer(child);
                }
            }
        }
        return result;
    }

    /** CUSTOM：取最宽档同为 CUSTOM 的所有角色 dept_ids 并集。 */
    private Set<Long> customDepts(List<SysRole> roles) {
        Set<Long> deptIds = new HashSet<>();
        for (SysRole role : roles) {
            if ("CUSTOM".equals(role.getDataScope()) && role.getDeptIds() != null) {
                deptIds.addAll(role.getDeptIds());
            }
        }
        return deptIds;
    }
}
