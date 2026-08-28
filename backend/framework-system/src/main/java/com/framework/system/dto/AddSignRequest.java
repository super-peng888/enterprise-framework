package com.framework.system.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 加签请求：position=before（前加签）/after（后加签）。
 */
@Data
public class AddSignRequest {

    @NotBlank(message = "position 不能为空（before/after）")
    private String position;

    @NotBlank(message = "加签人 assignee 不能为空")
    private String assignee;

    private String comment;
}
