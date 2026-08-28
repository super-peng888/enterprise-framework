package com.framework.system.service;

import com.framework.system.entity.SysAuditLog;
import com.framework.system.repository.SysAuditLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 审计日志落库。
 *
 * 本期实现：@Async 直接异步写 sys_audit_log。
 * 后续切换 RabbitMQ：由 AuditLogAspect 投递到 audit.exchange（routing key 按 module），
 * 本类改造为 @RabbitListener 消费落库，同时削峰、解耦主流程；通知与延迟提醒同理。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuditLogService {

    private final SysAuditLogRepository auditLogRepository;

    @Async
    public void record(Long userId, String username, String module, String action,
                       String bizId, String detail, String traceId, String ip) {
        try {
            SysAuditLog entity = new SysAuditLog();
            entity.setUserId(userId);
            entity.setUsername(username);
            entity.setModule(module);
            entity.setAction(action);
            entity.setBizId(bizId);
            entity.setDetail(detail);
            entity.setTraceId(traceId);
            entity.setIp(ip);
            auditLogRepository.save(entity);
        } catch (Exception e) {
            // 审计失败不影响主流程
            log.warn("审计日志落库失败 module={} action={} traceId={}: {}", module, action, traceId, e.getMessage());
        }
    }
}
