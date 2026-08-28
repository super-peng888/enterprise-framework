package com.framework.system.service;

import com.framework.system.entity.Notification;
import com.framework.system.repository.NotificationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 通知创建（审批引擎、内调接口、MQ 消费三路共用）。
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

    private final NotificationRepository notificationRepository;

    public Notification create(String userName, String type, String title, String content, String bizKey) {
        Notification notification = new Notification();
        notification.setUserName(userName);
        notification.setType(type);
        notification.setTitle(title);
        notification.setContent(content);
        notification.setBizKey(bizKey);
        notification.setRead(false);
        return notificationRepository.save(notification);
    }
}
