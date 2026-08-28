package com.framework.system.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SysRoleMenuPK implements Serializable {

    private Long roleId;
    private Long menuId;
}
