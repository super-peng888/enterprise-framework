package com.framework.system.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Entity
@NoArgsConstructor
@AllArgsConstructor
@IdClass(SysUserRolePK.class)
@Table(name = "sys_user_role")
public class SysUserRole {

    @Id
    private Long userId;

    @Id
    private Long roleId;
}
