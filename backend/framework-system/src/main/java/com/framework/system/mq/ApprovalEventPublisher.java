package com.framework.system.mq;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

/**
 * 审批事件发布器。发布失败仅告警不影响主流程（业务方状态可由对账/重推兜底）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ApprovalEventPublisher {

    private final RabbitTemplate rabbitTemplate;

    public void publishFinished(String templateCode, String businessKey, String status) {
        try {
            rabbitTemplate.convertAndSend(ApprovalFinishedEvent.EXCHANGE,
                    ApprovalFinishedEvent.ROUTING_KEY,
                    ApprovalFinishedEvent.of(templateCode, businessKey, status));
        } catch (Exception e) {
            log.warn("发布 approval.finished 事件失败 businessKey={} status={}: {}",
                    businessKey, status, e.getMessage());
        }
    }
}
