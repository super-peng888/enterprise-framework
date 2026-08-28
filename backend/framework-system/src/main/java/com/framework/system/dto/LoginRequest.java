package com.framework.system.dto;

import lombok.Data;

/**
 * 登录请求：二选一。
 * 1) 账号密码：username + password（用户名全局唯一，也支持真实姓名）；
 * 2) 飞书扫码：code（本期 mock 阶段传 "mock"）。
 */
@Data
public class LoginRequest {

    /** 用户名（账号密码登录）。 */
    private String username;

    /** 明文密码（账号密码登录）。 */
    private String password;

    /** 飞书扫码授权回调带回的 code；本期 mock 阶段传 "mock"。 */
    private String code;
}
