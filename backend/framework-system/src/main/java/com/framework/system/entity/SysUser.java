package com.framework.system.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "sys_user")
public class SysUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String username;

    /** BCrypt 密码哈希；任何接口都不得回传。 */
    @JsonIgnore
    private String password;

    private String realName;

    private String feishuUnionId;

    private String feishuOpenId;

    private Long deptId;

    /** 1 在职/启用，0 离职/禁用。 */
    private Integer status;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
