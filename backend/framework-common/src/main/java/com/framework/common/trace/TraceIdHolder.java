package com.framework.common.trace;

import java.util.UUID;

/**
 * TraceId 线程上下文。由网关/过滤器写入，审计、日志中读取，
 * 使用完必须 {@link #remove()} 防止线程复用导致串号。
 */
public final class TraceIdHolder {

    private static final ThreadLocal<String> HOLDER = new ThreadLocal<>();

    private TraceIdHolder() {
    }

    public static void set(String traceId) {
        HOLDER.set(traceId);
    }

    public static String get() {
        return HOLDER.get();
    }

    /** 取不到时生成一个并放入上下文。 */
    public static String getOrGenerate() {
        String traceId = HOLDER.get();
        if (traceId == null || traceId.isEmpty()) {
            traceId = generate();
            HOLDER.set(traceId);
        }
        return traceId;
    }

    public static void remove() {
        HOLDER.remove();
    }

    public static String generate() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
