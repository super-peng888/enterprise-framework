package com.framework.system.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * JWT 配置。
 */
@Data
@ConfigurationProperties(prefix = "jwt")
public class JwtProperties {

    /** HS256 签名密钥，必须 >= 32 字节，生产环境通过环境变量注入。 */
    private String secret;

    /** token 有效期（分钟）。 */
    private long expireMinutes = 720;
}
