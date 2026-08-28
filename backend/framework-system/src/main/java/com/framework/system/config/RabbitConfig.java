package com.framework.system.config;

import com.framework.system.mq.ApprovalFinishedEvent;
import com.framework.system.mq.NotificationEvent;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.DefaultJackson2JavaTypeMapper;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

/**
 * system 侧声明事件 exchange（topic）；approval.finished 的消费队列由消费方（业务服务）声明，
 * notification.send 的消费队列（framework.system.notification.send）由本模块声明并绑定。
 */
@Configuration
public class RabbitConfig {

    @Bean
    public TopicExchange frameworkEventsExchange() {
        return new TopicExchange(ApprovalFinishedEvent.EXCHANGE, true, false);
    }

    @Bean
    public Queue notificationSendQueue() {
        return QueueBuilder.durable(NotificationEvent.QUEUE).build();
    }

    @Bean
    public Binding notificationSendBinding(Queue notificationSendQueue, TopicExchange frameworkEventsExchange) {
        return BindingBuilder.bind(notificationSendQueue).to(frameworkEventsExchange)
                .with(NotificationEvent.ROUTING_KEY);
    }

    /**
     * JSON 消息转换：把生产端类名映射到本模块 DTO（biz 的通知事件 → system 消费侧 DTO）。
     */
    @Bean
    public Jackson2JsonMessageConverter jackson2JsonMessageConverter() {
        Jackson2JsonMessageConverter converter = new Jackson2JsonMessageConverter();
        DefaultJackson2JavaTypeMapper typeMapper = new DefaultJackson2JavaTypeMapper();
        typeMapper.setTrustedPackages("*");
        typeMapper.setIdClassMapping(Map.of(
                "com.framework.biz.mq.NotificationEvent", NotificationEvent.class));
        converter.setJavaTypeMapper(typeMapper);
        return converter;
    }

    @Bean
    public RabbitTemplate rabbitTemplate(org.springframework.amqp.rabbit.connection.ConnectionFactory connectionFactory,
                                         Jackson2JsonMessageConverter converter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(converter);
        return template;
    }
}
