package com.framework.system.repository;

import com.framework.system.entity.SysMenu;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysMenuRepository extends JpaRepository<SysMenu, Long> {

    @Query(value = "SELECT DISTINCT m.perm FROM sys_menu m "
            + "JOIN sys_role_menu rm ON rm.menu_id = m.id "
            + "JOIN sys_user_role ur ON ur.role_id = rm.role_id "
            + "WHERE ur.user_id = :userId AND m.perm IS NOT NULL AND m.perm <> ''",
            nativeQuery = true)
    List<String> findPermsByUserId(@Param("userId") Long userId);

    @Query(value = "SELECT m.* FROM sys_menu m "
            + "JOIN sys_role_menu rm ON rm.menu_id = m.id "
            + "JOIN sys_user_role ur ON ur.role_id = rm.role_id "
            + "WHERE ur.user_id = :userId ORDER BY m.sort, m.id",
            nativeQuery = true)
    List<SysMenu> findMenusByUserId(@Param("userId") Long userId);
}
