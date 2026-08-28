package com.framework.system.repository;

import com.framework.system.entity.FormDefinition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FormDefinitionRepository extends JpaRepository<FormDefinition, Long> {

    Optional<FormDefinition> findByCodeAndStatus(String code, String status);
}
