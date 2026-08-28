package com.framework.gateway.filter;

import tools.jackson.databind.ObjectMapper;
import com.framework.common.constant.Constants;
import com.framework.common.error.ErrorCode;
import com.framework.common.result.Result;
import com.framework.common.security.JwtUtils;
import io.jsonwebtoken.Claims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 统一 JWT 鉴权全局过滤器（order 在 TraceIdGlobalFilter 之后）。
 *
 * 白名单（直接放行）：
 * - /api/system/auth/login  登录接口本身
 * - /actuator/**            网关自身健康检查
 * - /api/STAR/internal/**   各服务内调接口（biz -> system 发起审批等），不走公网鉴权；
 *                           务必在 nginx 层屏蔽 /api/X/internal/ 的外放（见 deploy/nginx/conf.d/framework.conf）
 *
 * 其余 /api/** 请求：校验 Authorization Bearer token（与 framework-system 同一 HS256 密钥），
 * 失败返回 401 统一 JSON；成功则向下游注入 X-User-Id / X-User-Name（URL 编码，下游解码），
 * X-Trace-Id 由 TraceIdGlobalFilter 已写入，随请求自然透传。
 */
@Component
public class JwtAuthGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthGlobalFilter.class);

    private static final List<String> WHITELIST = List.of(
            "/api/system/auth/login",
            "/actuator/**",
            "/api/*/internal/**");

    private final AntPathMatcher pathMatcher = new AntPathMatcher();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JwtUtils jwtUtils;

    public JwtAuthGlobalFilter(@Value("${jwt.secret:framework-dev-secret-key-please-change-32bytes}") String secret) {
        this.jwtUtils = new JwtUtils(secret);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getRawPath();

        // 先剔除客户端伪造的用户头，防止绕过网关直连场景外的头注入
        ServerHttpRequest sanitized = exchange.getRequest().mutate()
                .headers(h -> {
                    h.remove(Constants.USER_ID_HEADER);
                    h.remove(Constants.USER_NAME_HEADER);
                })
                .build();

        if (isWhitelisted(path) || !path.startsWith("/api/")) {
            return chain.filter(exchange.mutate().request(sanitized).build());
        }

        String header = exchange.getRequest().getHeaders().getFirst(Constants.TOKEN_HEADER);
        if (!StringUtils.hasText(header) || !header.startsWith(Constants.TOKEN_PREFIX)) {
            return unauthorized(exchange);
        }

        Claims claims;
        try {
            claims = jwtUtils.parse(header.substring(Constants.TOKEN_PREFIX.length()));
        } catch (Exception e) {
            log.debug("JWT 校验失败: {} {}", path, e.getMessage());
            return unauthorized(exchange);
        }

        Long uid = jwtUtils.getUid(claims);
        // 「人」的口径统一为真实姓名：优先 realName claim，老 token 没有则回退 username
        String realName = jwtUtils.getRealName(claims);
        String displayName = StringUtils.hasText(realName) ? realName : jwtUtils.getUsername(claims);
        // 姓名可能含中文，URL 编码后下游 URLDecoder 解码
        ServerHttpRequest mutated = sanitized.mutate()
                .header(Constants.USER_ID_HEADER, String.valueOf(uid))
                .header(Constants.USER_NAME_HEADER,
                        URLEncoder.encode(displayName == null ? "" : displayName, StandardCharsets.UTF_8))
                .build();
        return chain.filter(exchange.mutate().request(mutated).build());
    }

    private boolean isWhitelisted(String path) {
        return WHITELIST.stream().anyMatch(pattern -> pathMatcher.match(pattern, path));
    }

    private Mono<Void> unauthorized(ServerWebExchange exchange) {
        return writeError(exchange, HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED.getMsg());
    }

    private Mono<Void> writeError(ServerWebExchange exchange, HttpStatus status, String msg) {
        var response = exchange.getResponse();
        response.setStatusCode(status);
        response.getHeaders().setContentType(new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8));
        try {
            byte[] body = objectMapper.writeValueAsBytes(Result.fail(status.value(), msg));
            DataBuffer buffer = response.bufferFactory().wrap(body);
            return response.writeWith(Mono.just(buffer));
        } catch (Exception e) {
            return response.setComplete();
        }
    }

    @Override
    public int getOrder() {
        // TraceIdGlobalFilter(-100) 之后，保证 401 响应也带 traceId
        return -90;
    }
}
