package com.framework.system.service;

import com.framework.system.entity.SysLoginLog;
import com.framework.system.repository.SysLoginLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 登录日志：成功/失败均落 sys_login_log。
 */
@Service
@RequiredArgsConstructor
public class LoginLogService {

    private final SysLoginLogRepository loginLogRepository;

    @Async
    public void record(Long userId, String username, String ip, String userAgent,
                       boolean success, String message) {
        SysLoginLog log = new SysLoginLog();
        log.setUserId(userId);
        log.setUsername(username);
        log.setIp(ip);
        log.setUserAgent(truncate(userAgent, 512));
        log.setSuccess(success);
        log.setMessage(truncate(message, 512));
        loginLogRepository.save(log);
    }

    private String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
