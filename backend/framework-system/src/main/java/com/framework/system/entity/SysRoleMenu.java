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
@IdClass(SysRoleMenuPK.class)
@Table(name = "sys_role_menu")
public class SysRoleMenu {

    @Id
    private Long roleId;

    @Id
    private Long menuId;
}
