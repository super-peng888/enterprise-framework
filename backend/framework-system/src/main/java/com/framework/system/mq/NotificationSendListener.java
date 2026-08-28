package com.framework.system.mq;

import com.framework.system.service.NotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * 消费 notification.send 事件（来自业务服务的业务动作通知），落 notification 表。
 * 与 /internal/notifications 内调接口并行，是不走 REST 的通知通道。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationSendListener {

    private final NotificationService notificationService;

    @RabbitListener(queues = NotificationEvent.QUEUE)
    public void onNotificationSend(NotificationEvent event) {
        log.info("收到 notification.send 事件 userName={} type={} bizKey={}",
                event.getUserName(), event.getType(), event.getBizKey());
        if (event.getUserName() == null || event.getUserName().isBlank()) {
            log.warn("notification.send 事件缺少 userName，已丢弃: {}", event.getTitle());
            return;
        }
        notificationService.create(event.getUserName(),
                event.getType() == null ? "SYSTEM" : event.getType(),
                event.getTitle(), event.getContent(), event.getBizKey());
    }
}
