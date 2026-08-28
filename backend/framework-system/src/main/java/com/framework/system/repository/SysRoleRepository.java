package com.framework.system.repository;

import com.framework.system.entity.SysRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SysRoleRepository extends JpaRepository<SysRole, Long> {

    Optional<SysRole> findByCode(String code);

    @Query(value = "SELECT r.code FROM sys_role r "
            + "JOIN sys_user_role ur ON ur.role_id = r.id "
            + "WHERE ur.user_id = :userId", nativeQuery = true)
    List<String> findRoleCodesByUserId(@Param("userId") Long userId);

    /** 用户全部角色实体（@DataScope 切面解析最宽数据范围用）。 */
    @Query(value = "SELECT r.* FROM sys_role r "
            + "JOIN sys_user_role ur ON ur.role_id = r.id "
            + "WHERE ur.user_id = :userId", nativeQuery = true)
    List<SysRole> findRolesByUserId(@Param("userId") Long userId);
}
