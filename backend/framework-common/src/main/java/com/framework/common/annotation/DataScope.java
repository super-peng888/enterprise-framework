package com.framework.common.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 数据权限注解：标注在控制器方法上，由切面解析当前用户所有角色
 * data_scope 的最宽档（ALL &gt; DEPT_AND_CHILD &gt; DEPT &gt; SELF &gt; CUSTOM）
 * 写入 DataScopeContext，业务查询据此叠加数据范围条件。
 *
 * ownerField/deptField 为实体属性名口径的约定，供业务方构建查询条件时参考
 * （如 SELF 档按 ownerField = 当前用户，DEPT 系档位按 deptField IN 解析出的部门集合）。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DataScope {

    /** 数据归属人字段（SELF 档使用），实体属性名。 */
    String ownerField() default "create_by";

    /** 数据归属部门字段（DEPT / DEPT_AND_CHILD / CUSTOM 档使用），实体属性名。 */
    String deptField() default "dept_id";
}
