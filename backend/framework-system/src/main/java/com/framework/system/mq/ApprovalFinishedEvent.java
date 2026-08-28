package com.framework.system.mq;

import java.io.Serializable;

/**
 * 审批结束事件（approval.finished）。
 * system 在实例审批通过/驳回后发布到 exchange framework.events，业务服务消费后回写业务状态。
 * 事件契约字段保持稳定。
 */
public class ApprovalFinishedEvent implements Serializable {

    /** exchange / routing key 常量，业务模块按同名契约消费。 */
    public static final String EXCHANGE = "framework.events";
    public static final String ROUTING_KEY = "approval.finished";

    private String templateCode;
    private String businessKey;
    /** APPROVED / REJECTED。 */
    private String status;

    public static ApprovalFinishedEvent of(String templateCode, String businessKey, String status) {
        ApprovalFinishedEvent e = new ApprovalFinishedEvent();
        e.templateCode = templateCode;
        e.businessKey = businessKey;
        e.status = status;
        return e;
    }

    public String getTemplateCode() {
        return templateCode;
    }

    public String getBusinessKey() {
        return businessKey;
    }

    public String getStatus() {
        return status;
    }
}
