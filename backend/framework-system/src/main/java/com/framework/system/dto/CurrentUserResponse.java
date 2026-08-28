package com.framework.system.dto;

import com.framework.system.entity.SysUser;
import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

/**
 * 当前登录用户信息：基本信息 + 角色编码 + 权限点。
 */
@Data
@AllArgsConstructor
public class CurrentUserResponse {

    private SysUser user;

    private List<String> roles;

    private List<String> perms;
}
