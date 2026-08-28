package com.framework.system.dto;

import tools.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 发起审批请求。
 */
@Data
public class CreateInstanceRequest {

    @NotBlank(message = "模板编码不能为空")
    private String templateCode;

    /** 业务方关联键，如 leave:123（业务方自定义前缀）。 */
    private String businessKey;

    @NotBlank(message = "标题不能为空")
    private String title;

    /** 表单提交数据（对应模板的 Formily Schema）。 */
    private JsonNode formData;

    /** 发起人姓名（内网调用无登录态时由调用方传入）。 */
    private String initiatorName;
}
