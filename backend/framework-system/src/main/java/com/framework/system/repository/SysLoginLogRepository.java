package com.framework.system.repository;

import com.framework.system.entity.SysLoginLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysLoginLogRepository extends JpaRepository<SysLoginLog, Long> {
}
