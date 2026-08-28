package com.framework.system.security;

import java.io.Serializable;

/**
 * 已登录用户主体，由 JwtAuthFilter 解析 token 后放入 SecurityContext。
 */
public record LoginUser(Long id, String username) implements Serializable {
}
