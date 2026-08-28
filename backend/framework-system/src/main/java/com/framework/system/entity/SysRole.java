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
import java.util.List;

@Data
@Entity
@Table(name = "sys_role")
public class SysRole {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String code;

    private String name;

    /** 数据范围（五档，取用户所有角色的最宽档）：ALL 全部 / DEPT_AND_CHILD 本部门及以下 /
     *  DEPT 本部门 / SELF 本人 / CUSTOM 自定义部门集合（deptIds）。 */
    private String dataScope;

    /** CUSTOM 档自定义部门 ID 集合，JSON 数组落 jsonb。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<Long> deptIds;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
