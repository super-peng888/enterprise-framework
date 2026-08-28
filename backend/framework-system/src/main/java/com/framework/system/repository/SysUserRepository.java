package com.framework.system.repository;

import com.framework.system.entity.SysUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long>, JpaSpecificationExecutor<SysUser> {

    /** 用户名全局唯一。 */
    Optional<SysUser> findByUsername(String username);

    /** 姓名登录兜底（演示环境友好）：用户名查不到时按真实姓名查 */
    Optional<SysUser> findByRealName(String realName);

    Optional<SysUser> findByFeishuUnionId(String feishuUnionId);

    List<SysUser> findByDeptId(Long deptId);

    /** 按角色编码查在职用户姓名（审批引擎 approverType=role 解析用，全库角色用户）。 */
    @Query(value = "SELECT u.real_name FROM sys_user u "
            + "JOIN sys_user_role ur ON ur.user_id = u.id "
            + "JOIN sys_role r ON r.id = ur.role_id "
            + "WHERE r.code = :roleCode AND u.status = 1", nativeQuery = true)
    List<String> findRealNamesByRoleCode(@Param("roleCode") String roleCode);
}
