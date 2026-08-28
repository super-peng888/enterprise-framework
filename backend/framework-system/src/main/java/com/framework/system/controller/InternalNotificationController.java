package com.framework.system.controller;

import com.framework.common.result.Result;
import com.framework.system.entity.Notification;
import com.framework.system.service.NotificationService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 内调通知接口（免 JWT，仅集群内可达）：其他服务直连建通知。
 * 不走 REST 的通道见 MQ notification.send 事件（NotificationSendListener）。
 */
@RestController
@RequestMapping("/internal/notifications")
@RequiredArgsConstructor
public class InternalNotificationController {

    private final NotificationService notificationService;

    @PostMapping
    public Result<Notification> create(@RequestBody CreateNotificationRequest req) {
        if (req.getUserName() == null || req.getUserName().isBlank()
                || req.getTitle() == null || req.getTitle().isBlank()) {
            return Result.fail(400, "userName/title 不能为空");
        }
        String type = (req.getType() == null || req.getType().isBlank()) ? "SYSTEM" : req.getType();
        return Result.ok(notificationService.create(req.getUserName(), type,
                req.getTitle(), req.getContent(), req.getBizKey()));
    }

    @Data
    public static class CreateNotificationRequest {
        private String userName;
        private String type;
        private String title;
        private String content;
        private String bizKey;
    }
}
