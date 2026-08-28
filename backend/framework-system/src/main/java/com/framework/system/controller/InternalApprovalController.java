package com.framework.system.controller;

import com.framework.common.result.Result;
import com.framework.system.dto.CreateInstanceRequest;
import com.framework.system.entity.ApprovalInstance;
import com.framework.system.service.ApprovalEngineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 内网调用接口（无 JWT 登录态，SecurityConfig 放行 /internal/**）。
 * 仅供集群内服务直连调用（如业务服务发起审批），禁止暴露到网关/公网；
 * 生产环境应加内网令牌或 mTLS 校验。
 */
@RestController
@RequestMapping("/internal")
@RequiredArgsConstructor
public class InternalApprovalController {

    private final ApprovalEngineService approvalEngine;

    /**
     * 发起审批（内网）：与 /approval/instances 同逻辑，发起人由调用方传入。
     */
    @PostMapping("/approval/instances")
    public Result<ApprovalInstance> create(@Valid @RequestBody CreateInstanceRequest req) {
        return Result.ok(approvalEngine.createInstance(req.getTemplateCode(), req.getBusinessKey(),
                req.getTitle(), req.getFormData(), null, req.getInitiatorName()));
    }
}
