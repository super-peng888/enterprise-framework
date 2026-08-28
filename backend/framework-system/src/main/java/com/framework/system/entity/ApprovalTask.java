package com.framework.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 审批任务。approver 节点生成 PENDING 任务；cc 节点只记录（status=CC），不阻塞流程。
 */
@Data
@Entity
@Table(name = "approval_task")
public class ApprovalTask {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long instanceId;

    /** 节点在流程树中的索引路径，如 "0"、"1/0/0"（条件节点1-分支0-子节点0）。 */
    private String nodeId;

    private String nodeName;

    /** approver/cc。 */
    private String nodeType;

    private String assigneeName;

    /** or 或签 / all 会签（仅 approver 节点）。 */
    private String signMode;

    /** PENDING/APPROVED/REJECTED/CC/WAITING（被前加签挂起的原任务）/CANCELED（被回退作废，不进列表、不参与进度）。 */
    private String status;

    /** NORMAL / ADD_BEFORE（前加签）/ ADD_AFTER（后加签）。 */
    private String origin = "NORMAL";

    /** 加签任务指向被加签的原任务。 */
    private Long parentTaskId;

    private String comment;

    private LocalDateTime actedAt;

    private Integer sort;
}
