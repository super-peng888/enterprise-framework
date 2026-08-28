package com.framework.common.context;

import java.io.Serializable;

/**
 * 当前请求用户。由网关完成 JWT 校验后通过 X-User-Id / X-User-Name 请求头注入，
 * 下游过滤器解析后放入 {@link UserContext}。
 */
public record CurrentUser(Long id, String username) implements Serializable {
}
