package com.framework.system.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class LoginResponse {

    private String token;

    /** token 类型：Bearer。 */
    private String tokenType;
}
