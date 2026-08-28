package com.framework.common.error;

/**
 * 统一错误码。0 成功；4xx/5xx 与 HTTP 语义对齐；10000+ 为业务错误码。
 */
public enum ErrorCode {

    SUCCESS(0, "成功"),
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未认证或认证已过期"),
    FORBIDDEN(403, "无权限访问"),
    NOT_FOUND(404, "资源不存在"),
    SYSTEM_ERROR(500, "系统内部错误"),

    LOGIN_FAILED(10001, "登录失败"),
    TOKEN_INVALID(10002, "token 无效或已过期"),
    USER_DISABLED(10003, "用户不存在或已禁用/离职"),
    PERMISSION_DENIED(10004, "缺少所需权限点");

    private final int code;
    private final String msg;

    ErrorCode(int code, String msg) {
        this.code = code;
        this.msg = msg;
    }

    public int getCode() {
        return code;
    }

    public String getMsg() {
        return msg;
    }
}
