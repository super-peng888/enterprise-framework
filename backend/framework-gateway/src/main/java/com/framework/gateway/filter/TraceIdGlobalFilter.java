package com.framework.gateway.filter;

import com.framework.common.constant.Constants;
import com.framework.common.trace.TraceIdHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * 全局过滤器：
 * 1. 请求无 X-Trace-Id 时生成，写入下游请求头与响应头；
 * 2. 记录请求方法 / 路径 / 状态码 / 耗时日志。
 */
@Component
public class TraceIdGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(TraceIdGlobalFilter.class);

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long start = System.currentTimeMillis();
        ServerHttpRequest request = exchange.getRequest();

        String traceId = request.getHeaders().getFirst(Constants.TRACE_ID_HEADER);
        if (!StringUtils.hasText(traceId)) {
            traceId = TraceIdHolder.generate();
        }
        final String finalTraceId = traceId;

        ServerHttpRequest mutated = request.mutate()
                .header(Constants.TRACE_ID_HEADER, finalTraceId)
                .build();
        exchange.getResponse().getHeaders().set(Constants.TRACE_ID_HEADER, finalTraceId);

        return chain.filter(exchange.mutate().request(mutated).build())
                .then(Mono.fromRunnable(() -> log.info("{} {} -> {} ({} ms) traceId={}",
                        request.getMethod(),
                        request.getURI().getRawPath(),
                        exchange.getResponse().getStatusCode(),
                        System.currentTimeMillis() - start,
                        finalTraceId)));
    }

    @Override
    public int getOrder() {
        // 尽量靠前，保证后续过滤器与下游都能拿到 traceId
        return -100;
    }
}
