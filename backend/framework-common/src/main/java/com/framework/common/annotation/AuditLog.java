package com.framework.common.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 审计日志注解。标注在需要记录操作审计的 Controller 方法上，
 * 由各服务的 AuditLogAspect 环绕拦截并落 sys_audit_log。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AuditLog {

    /** 业务模块，如 system-user / biz-project。 */
    String module();

    /** 操作动作，如 新增用户 / 删除角色。 */
    String action();
}
