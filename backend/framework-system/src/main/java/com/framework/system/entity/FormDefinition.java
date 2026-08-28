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
 * 动态表单定义：schema 为 Formily JSON Schema。
 */
@Data
@Entity
@Table(name = "form_definition")
public class FormDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 编码：全局唯一（如 LEAVE_APPLY），供前端任意页面按 code 引用。 */
    @Column(length = 64)
    private String code;

    private String name;

    /** Formily JSON Schema，JSON 字符串落 jsonb。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String schema;

    /** 启用/停用。 */
    private String status;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
