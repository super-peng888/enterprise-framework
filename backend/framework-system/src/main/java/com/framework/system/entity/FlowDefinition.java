package com.framework.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 流程定义：flow_json 为树形节点（approver/cc/condition）。
 */
@Data
@Entity
@Table(name = "flow_definition")
public class FlowDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    /** 树形流程 JSON，JSON 字符串落 jsonb。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String flowJson;

    /** 关联表单（表单中心 form_definition.id）；保存时自动维护同名审批模板。 */
    private Long formId;

    /** 启用/停用。 */
    private String status;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
