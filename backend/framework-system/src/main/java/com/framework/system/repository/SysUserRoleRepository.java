package com.framework.system.repository;

import com.framework.system.entity.SysUserRole;
import com.framework.system.entity.SysUserRolePK;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysUserRoleRepository extends JpaRepository<SysUserRole, SysUserRolePK> {

    void deleteByUserId(Long userId);
}
