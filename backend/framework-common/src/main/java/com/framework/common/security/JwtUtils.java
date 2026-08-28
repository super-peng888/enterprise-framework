package com.framework.common.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

/**
 * 轻量 JWT 校验工具（HS256，与 framework-system 的 JwtService 同密钥同格式）。
 * 供 framework-gateway 等不做 Spring Security 全量认证的场景使用；
 * 密钥通过构造器传入，调用方自行从配置读取。
 */
public class JwtUtils {

    private final SecretKey key;

    public JwtUtils(String secret) {
        // HS256 要求密钥 >= 32 字节
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 解析并校验 token（签名、过期时间）。
     *
     * @throws io.jsonwebtoken.JwtException 签名非法 / 已过期 / 结构错误
     */
    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /** 用户ID（JwtService 签发时写入的 uid claim）。 */
    public Long getUid(Claims claims) {
        return claims.get("uid", Long.class);
    }

    /** 用户名（JWT subject）。 */
    public String getUsername(Claims claims) {
        return claims.getSubject();
    }

    /** 真实姓名（JwtService 签发时写入的 realName claim，老 token 可能没有）。 */
    public String getRealName(Claims claims) {
        return claims.get("realName", String.class);
    }
}
