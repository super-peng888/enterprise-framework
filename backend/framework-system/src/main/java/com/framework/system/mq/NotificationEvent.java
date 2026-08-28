package com.framework.system.mq;

import java.io.Serializable;

/**
 * 通知发送事件（notification.send）消费侧 DTO。
 * 生产端为业务服务的 com.framework.biz.mq.NotificationEvent（经 idClassMapping 映射到本类）。
 */
public class NotificationEvent implements Serializable {

    public static final String EXCHANGE = "framework.events";
    public static final String ROUTING_KEY = "notification.send";
    public static final String QUEUE = "framework.system.notification.send";

    private String userName;
    private String type;
    private String title;
    private String content;
    private String bizKey;

    public String getUserName() {
        return userName;
    }

    public void setUserName(String userName) {
        this.userName = userName;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getBizKey() {
        return bizKey;
    }

    public void setBizKey(String bizKey) {
        this.bizKey = bizKey;
    }
}
