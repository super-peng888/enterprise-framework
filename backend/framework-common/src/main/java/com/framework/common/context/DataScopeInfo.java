package com.framework.common.context;

import java.io.Serializable;
import java.util.Set;

/**
 * 数据范围解析结果（@DataScope 切面写入 {@link DataScopeContext}）。
 *
 * @param type    五档范围：ALL 全部 / DEPT_AND_CHILD 本部门及以下 / DEPT 本部门 /
 *                SELF 本人 / CUSTOM 自定义部门集合
 * @param deptIds DEPT/DEPT_AND_CHILD/CUSTOM 命中的部门 ID 集合（其余档为空）
 * @param userId  SELF 档限定的用户 ID（其余档为 null）
 */
public record DataScopeInfo(ScopeType type, Set<Long> deptIds, Long userId) implements Serializable {

    public enum ScopeType {
        ALL, DEPT_AND_CHILD, DEPT, SELF, CUSTOM
    }

    public static DataScopeInfo all() {
        return new DataScopeInfo(ScopeType.ALL, Set.of(), null);
    }

    public static DataScopeInfo depts(ScopeType type, Set<Long> deptIds) {
        return new DataScopeInfo(type, deptIds == null ? Set.of() : Set.copyOf(deptIds), null);
    }

    public static DataScopeInfo self(Long userId) {
        return new DataScopeInfo(ScopeType.SELF, Set.of(), userId);
    }
}
