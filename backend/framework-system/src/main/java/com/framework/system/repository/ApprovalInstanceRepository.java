package com.framework.system.repository;

import com.framework.system.entity.ApprovalInstance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApprovalInstanceRepository extends JpaRepository<ApprovalInstance, Long> {

    Page<ApprovalInstance> findByInitiatorNameOrderByIdDesc(String initiatorName, Pageable pageable);
}
