package com.framework.system.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SysUserRolePK implements Serializable {

    private Long userId;
    private Long roleId;
}
