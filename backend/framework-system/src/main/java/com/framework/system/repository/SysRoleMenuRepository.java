package com.framework.system.repository;

import com.framework.system.entity.SysRoleMenu;
import com.framework.system.entity.SysRoleMenuPK;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysRoleMenuRepository extends JpaRepository<SysRoleMenu, SysRoleMenuPK> {

    void deleteByRoleId(Long roleId);
}
