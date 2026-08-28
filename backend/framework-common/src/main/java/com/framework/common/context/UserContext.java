package com.framework.common.context;

/**
 * 当前用户线程上下文。由下游用户过滤器写入，审计切面等读取，
 * 使用完必须 {@link #remove()} 防止线程复用导致串号。
 */
public final class UserContext {

    private static final ThreadLocal<CurrentUser> HOLDER = new ThreadLocal<>();

    private UserContext() {
    }

    public static void set(CurrentUser user) {
        HOLDER.set(user);
    }

    /** 未经过网关鉴权（匿名 / 内调）时返回 null。 */
    public static CurrentUser get() {
        return HOLDER.get();
    }

    public static void remove() {
        HOLDER.remove();
    }
}
