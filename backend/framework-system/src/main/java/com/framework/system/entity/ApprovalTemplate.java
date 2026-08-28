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
 * 审批模板：绑定表单 + 流程，业务方按 code 发起审批（code 全局唯一）。
 */
@Data
@Entity
@Table(name = "approval_template")
public class ApprovalTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String code;

    private String name;

    private Long formId;

    private Long flowId;

    /** 启用/停用。 */
    private String status;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
