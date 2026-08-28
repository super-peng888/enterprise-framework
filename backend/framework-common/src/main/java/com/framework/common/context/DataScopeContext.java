package com.framework.common.context;

/**
 * 数据范围线程上下文。@DataScope 切面在控制器方法执行前解析当前用户
 * 所有角色 data_scope 的最宽档并写入，业务查询叠加使用，
 * 使用完必须 {@link #remove()} 防止线程复用串号。
 */
public final class DataScopeContext {

    private static final ThreadLocal<DataScopeInfo> HOLDER = new ThreadLocal<>();

    private DataScopeContext() {
    }

    public static void set(DataScopeInfo info) {
        HOLDER.set(info);
    }

    /** 未标注 @DataScope 或未登录时返回 null（调用方按不限制处理）。 */
    public static DataScopeInfo get() {
        return HOLDER.get();
    }

    public static void remove() {
        HOLDER.remove();
    }
}
