package com.framework.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 审批实例。
 */
@Data
@Entity
@Table(name = "approval_instance")
public class ApprovalInstance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long templateId;

    private String title;

    private String businessKey;

    /** 表单提交数据，JSON 字符串落 jsonb。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String formData;

    /** 流程版本快照：创建实例时冻结的 flow_definition.flow_json，引擎一律按快照展开，
     *  设计器后续修改流程定义不影响在途实例；历史实例（无快照）回退读模板当前流程定义。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String flowSnapshot;

    /** 表单版本快照：创建实例时冻结的 form_definition.schema，详情回显一律按快照，
     *  表单设计器后续修改不影响在途实例；历史实例（无快照）回退读模板当前表单定义。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String formSnapshot;

    /** PENDING/APPROVED/REJECTED/CANCELED/RETURNED（退回发起人，等重新提交）。 */
    private String status;

    /** 当前节点：nodeId 路径 + 节点名（如 "1/0/0 总监审批"）。 */
    private String currentNodePath;

    private Long initiatorId;

    private String initiatorName;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime finishedAt;
}
