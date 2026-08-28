package com.framework.system.dto;

import lombok.Data;

import java.util.Map;

/**
 * 审批通过/驳回请求。
 * 驳回扩展（仿飞书「驳回到指定节点」）：targetType 缺省/end 为整体驳回；
 * prev 回退到上一个审批节点；node 回退到 targetNodeId 指定的前置审批节点；
 * initiator 退回发起人（实例置 RETURNED，待重新提交）。
 * 字段级审批权限：approve 时可携带审批人编辑过的表单字段，引擎只放行节点
 * fieldPerms 中标记为 editable 的 key，merge 进实例 form_data，其余静默丢弃。
 */
@Data
public class ActRequest {

    private String comment;

    /** 驳回目标：end(默认)/prev/node/initiator，仅驳回时有效。 */
    private String targetType;

    /** targetType=node 时必填：目标节点在流程树中的索引路径（如 "0"、"1/0/0"）。 */
    private String targetNodeId;

    /** 审批人编辑过的表单字段（仅 approve 有效，按节点 fieldPerms 白名单 merge）。 */
    private Map<String, Object> formData;
}
