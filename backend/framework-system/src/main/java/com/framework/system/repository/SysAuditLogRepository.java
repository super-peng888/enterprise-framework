package com.framework.system.repository;

import com.framework.system.entity.SysAuditLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysAuditLogRepository extends JpaRepository<SysAuditLog, Long> {
}
