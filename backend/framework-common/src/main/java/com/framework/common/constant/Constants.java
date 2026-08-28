package com.framework.common.constant;

/**
 * 跨服务通用常量。
 */
public final class Constants {

    private Constants() {
    }

    /** 链路追踪请求头。 */
    public static final String TRACE_ID_HEADER = "X-Trace-Id";

    /** 认证请求头。 */
    public static final String TOKEN_HEADER = "Authorization";

    /** token 前缀（含尾随空格）。 */
    public static final String TOKEN_PREFIX = "Bearer ";

    /** token 类型（响应体中使用，不含空格）。 */
    public static final String TOKEN_TYPE = "Bearer";

    /** 网关注入的用户ID请求头（下游可直接信任，见网关 JwtAuthGlobalFilter）。 */
    public static final String USER_ID_HEADER = "X-User-Id";

    /** 网关注入的用户名请求头（URL 编码 UTF-8，下游需 URLDecoder 解码）。 */
    public static final String USER_NAME_HEADER = "X-User-Name";

    /** 用户状态：在职/启用。 */
    public static final int USER_STATUS_ENABLED = 1;

    /** 用户状态：离职/禁用。 */
    public static final int USER_STATUS_DISABLED = 0;
}
