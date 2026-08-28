package com.framework.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 通知中心：审批任务、系统广播等站内通知。
 * 生产来源：审批引擎直接落库（APPROVAL/CC）、/internal/notifications 内调、
 * MQ notification.send 事件（业务服务扩展类型，如 OVERDUE 等）。
 */
@Data
@Entity
@Table(name = "notification")
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 接收人姓名（sys_user.real_name 人名口径）。 */
    private String userName;

    /** APPROVAL / CC（审批抄送）/ SYSTEM，业务方可扩展自定义类型。 */
    private String type;

    private String title;

    @Column(columnDefinition = "text")
    private String content;

    /** 业务定位键，如 approval:7（业务方自定义前缀）。 */
    private String bizKey;

    @Column(name = "is_read")
    private Boolean read;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
