package com.framework.common.result;

import com.framework.common.error.ErrorCode;

import java.io.Serializable;

/**
 * 统一返回体。
 *
 * @param <T> 业务数据类型
 */
public class Result<T> implements Serializable {

    private int code;
    private String msg;
    private T data;

    public Result() {
    }

    public Result(int code, String msg, T data) {
        this.code = code;
        this.msg = msg;
        this.data = data;
    }

    public static <T> Result<T> ok() {
        return new Result<>(ErrorCode.SUCCESS.getCode(), ErrorCode.SUCCESS.getMsg(), null);
    }

    public static <T> Result<T> ok(T data) {
        return new Result<>(ErrorCode.SUCCESS.getCode(), ErrorCode.SUCCESS.getMsg(), data);
    }

    public static <T> Result<T> fail(String msg) {
        return new Result<>(ErrorCode.SYSTEM_ERROR.getCode(), msg, null);
    }

    public static <T> Result<T> fail(int code, String msg) {
        return new Result<>(code, msg, null);
    }

    public static <T> Result<T> fail(ErrorCode errorCode) {
        return new Result<>(errorCode.getCode(), errorCode.getMsg(), null);
    }

    public boolean isSuccess() {
        return this.code == ErrorCode.SUCCESS.getCode();
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public String getMsg() {
        return msg;
    }

    public void setMsg(String msg) {
        this.msg = msg;
    }

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }
}
