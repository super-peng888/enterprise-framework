package com.framework.system.dto;

import tools.jackson.databind.JsonNode;
import lombok.Data;

/**
 * 重新提交审批请求（实例被退回发起人 RETURNED 后）。
 */
@Data
public class ResubmitRequest {

    /** 可选：覆盖实例 form_data，条件分支按新数据重新求值。 */
    private JsonNode formData;
}
