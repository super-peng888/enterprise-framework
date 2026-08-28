package com.framework.system;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableAsync;

@EnableAsync
@ConfigurationPropertiesScan
@SpringBootApplication
public class FrameworkSystemApplication {

    public static void main(String[] args) {
        SpringApplication.run(FrameworkSystemApplication.class, args);
    }
}
