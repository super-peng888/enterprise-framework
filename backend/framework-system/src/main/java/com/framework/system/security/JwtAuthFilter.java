package com.framework.system.security;

import com.framework.common.constant.Constants;
import com.framework.common.context.CurrentUser;
import com.framework.common.context.UserContext;
import com.framework.common.trace.TraceIdHolder;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * JWT 认证过滤器：两种认证来源二选一（网关注入头优先，Bearer token 兜底）。
 * 同时接管 X-Trace-Id（网关已写入，直通调用时自行生成），
 * 当前用户放入 UserContext（请求结束统一 remove）。
 */
@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String traceId = request.getHeader(Constants.TRACE_ID_HEADER);
        TraceIdHolder.set(StringUtils.hasText(traceId) ? traceId : TraceIdHolder.generate());
        try {
            String gatewayUid = request.getHeader(Constants.USER_ID_HEADER);
            if (StringUtils.hasText(gatewayUid)) {
                // 经网关进入：网关已完成 JWT 校验并注入 X-User-* 头，直接信任建 LoginUser。
                // 注意：绕过网关直连本服务时客户端可伪造该头，生产环境应将服务端口限制在内网
                // （或改用内网令牌/mTLS），公网只暴露网关。
                String username = request.getHeader(Constants.USER_NAME_HEADER);
                if (StringUtils.hasText(username)) {
                    username = URLDecoder.decode(username, StandardCharsets.UTF_8);
                }
                Long uid = Long.valueOf(gatewayUid);
                LoginUser loginUser = new LoginUser(uid, username);
                UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(loginUser, null, List.of());
                SecurityContextHolder.getContext().setAuthentication(authentication);
                UserContext.set(new CurrentUser(uid, username));
            } else {
                // 直连本服务（无网关）：自行校验 Bearer token
                String header = request.getHeader(Constants.TOKEN_HEADER);
                if (StringUtils.hasText(header) && header.startsWith(Constants.TOKEN_PREFIX)) {
                    try {
                        Claims claims = jwtService.parse(header.substring(Constants.TOKEN_PREFIX.length()));
                        Long uid = claims.get("uid", Long.class);
                        LoginUser loginUser = new LoginUser(uid, claims.getSubject());
                        UsernamePasswordAuthenticationToken authentication =
                                new UsernamePasswordAuthenticationToken(loginUser, null, List.of());
                        SecurityContextHolder.getContext().setAuthentication(authentication);
                        UserContext.set(new CurrentUser(uid, claims.getSubject()));
                    } catch (JwtException | IllegalArgumentException e) {
                        // 不注入认证信息，交由 Security 的 entryPoint 返回 401
                        SecurityContextHolder.clearContext();
                    }
                }
            }
            filterChain.doFilter(request, response);
        } finally {
            TraceIdHolder.remove();
            UserContext.remove();
        }
    }
}
