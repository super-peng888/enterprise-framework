package com.framework.system.security;

import com.framework.system.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

/**
 * JWT 签发与校验（HS256）。
 */
@Service
public class JwtService {

    private final SecretKey key;
    private final long expireMinutes;

    public JwtService(JwtProperties properties) {
        // HS256 要求密钥 >= 32 字节
        this.key = Keys.hmacShaKeyFor(properties.getSecret().getBytes(StandardCharsets.UTF_8));
        this.expireMinutes = properties.getExpireMinutes();
    }

    public String generate(Long userId, String username, String realName) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(username)
                .claim("uid", userId)
                // 真实姓名：网关据此注入 X-User-Name，下游「人」的口径统一为 realName
                .claim("realName", realName)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expireMinutes, ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
