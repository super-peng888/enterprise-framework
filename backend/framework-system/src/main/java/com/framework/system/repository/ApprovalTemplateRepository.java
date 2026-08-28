package com.framework.system.repository;

import com.framework.system.entity.ApprovalTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ApprovalTemplateRepository extends JpaRepository<ApprovalTemplate, Long> {

    Optional<ApprovalTemplate> findByCode(String code);
}
