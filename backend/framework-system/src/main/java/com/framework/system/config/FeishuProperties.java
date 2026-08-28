package com.framework.system.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 飞书企业自建应用配置。真实换 token 流程见 AuthController 注释，本期仅占位。
 */
@Data
@ConfigurationProperties(prefix = "feishu")
public class FeishuProperties {

    /** 企业自建应用 App ID。 */
    private String appId;

    /** 企业自建应用 App Secret。 */
    private String appSecret;

    /** 扫码授权后的重定向地址（需与飞书开放平台后台配置一致）。 */
    private String redirectUri;
}
