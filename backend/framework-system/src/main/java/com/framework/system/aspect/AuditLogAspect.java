package com.framework.system.aspect;

import com.framework.common.annotation.AuditLog;
import com.framework.common.trace.TraceIdHolder;
import com.framework.system.security.LoginUser;
import com.framework.system.service.AuditLogService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * 审计切面：环绕拦截 @AuditLog 标注的方法，
 * 记录操作人 / 模块 / 动作 / 业务主键 / 参数摘要 / traceId / IP，异步落 sys_audit_log。
 */
@Aspect
@Component
@RequiredArgsConstructor
public class AuditLogAspect {

    private static final int ARGS_MAX_LENGTH = 1000;

    private final AuditLogService auditLogService;

    @Around("@annotation(auditLog)")
    public Object around(ProceedingJoinPoint pjp, AuditLog auditLog) throws Throwable {
        Long userId = null;
        String username = "anonymous";
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof LoginUser loginUser) {
            userId = loginUser.id();
            username = loginUser.username();
        }

        String argsSummary = summarizeArgs(pjp.getArgs());
        String bizId = extractBizId(pjp.getArgs());
        String ip = currentIp();

        String error = null;
        try {
            return pjp.proceed();
        } catch (Throwable t) {
            error = t.getClass().getSimpleName() + ": " + t.getMessage();
            throw t;
        } finally {
            // detail 为 jsonb，手工拼装简单 JSON，参数摘要已做转义与截断
            String detail = "{\"args\":\"" + escape(argsSummary) + "\","
                    + "\"success\":" + (error == null) + ","
                    + (error == null ? "" : "\"error\":\"" + escape(error) + "\",")
                    + "\"method\":\"" + pjp.getSignature().toShortString() + "\"}";
            auditLogService.record(userId, username, auditLog.module(), auditLog.action(),
                    bizId, detail, TraceIdHolder.get(), ip);
        }
    }

    /** 第一个 Long 型参数视为业务主键（如路径上的 {id}）。 */
    private String extractBizId(Object[] args) {
        if (args == null) {
            return null;
        }
        return Arrays.stream(args)
                .filter(Long.class::isInstance)
                .map(String::valueOf)
                .findFirst()
                .orElse(null);
    }

    private String summarizeArgs(Object[] args) {
        if (args == null || args.length == 0) {
            return "";
        }
        String summary = Arrays.stream(args)
                .filter(a -> !(a instanceof HttpServletRequest) && !(a instanceof MultipartFile))
                .map(String::valueOf)
                .collect(Collectors.joining(", "));
        if (summary.length() > ARGS_MAX_LENGTH) {
            summary = summary.substring(0, ARGS_MAX_LENGTH) + "...";
        }
        return summary;
    }

    private String currentIp() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            HttpServletRequest request = attrs.getRequest();
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                return forwarded.split(",")[0].trim();
            }
            return request.getRemoteAddr();
        }
        return null;
    }

    private String escape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
