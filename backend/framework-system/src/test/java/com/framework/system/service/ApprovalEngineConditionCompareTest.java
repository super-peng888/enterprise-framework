package com.framework.system.service;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 条件分支类型感知比较（ApprovalEngineService.compare）单测：
 * - 两边均可解析为数值（数字 JSON 节点或数字字符串 "5"/5/"5.5"）→ 数值比较；
 * - 否则 = / ≠ 按字符串比，< ≤ > ≥ 判不命中（不做字符串大小比较）。
 */
class ApprovalEngineConditionCompareTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String raw) {
        return MAPPER.readTree(raw);
    }

    // ---------------- 数值比较（支持全部六种操作符） ----------------

    @Test
    void numericStringComparison_9LessThan10() {
        // 字符串比较会得 "9" > "10"，数值比较必须为 true
        assertThat(ApprovalEngineService.compare("days", json("\"9\""), "<", json("\"10\""))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("\"9\""), "<", json("10"))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("9"), "<", json("\"10\""))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("9"), "<", json("10"))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("\"10\""), "<", json("\"9\""))).isFalse();
    }

    @Test
    void numericComparison_allOperators() {
        assertThat(ApprovalEngineService.compare("days", json("5.5"), ">", json("5"))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("\"5.5\""), ">", json("\"5\""))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("5"), ">=", json("5"))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("5"), "≤", json("5"))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("5"), "=", json("\"5\""))).isTrue();
        assertThat(ApprovalEngineService.compare("days", json("5"), "!=", json("5.0"))).isFalse();
        assertThat(ApprovalEngineService.compare("days", json("4"), "≠", json("5"))).isTrue();
    }

    // ---------------- 非数值：= / ≠ 字符串比较，其余判不命中 ----------------

    @Test
    void nonNumeric_relationalOperatorsReturnFalse() {
        // 不走字符串大小比较（字符串比 "abc" > "10" 会得到 true，属于配置错误静默出错）
        assertThat(ApprovalEngineService.compare("days", json("\"abc\""), "<", json("\"10\""))).isFalse();
        assertThat(ApprovalEngineService.compare("days", json("\"abc\""), ">", json("\"10\""))).isFalse();
        assertThat(ApprovalEngineService.compare("days", json("\"abc\""), "<=", json("10"))).isFalse();
        assertThat(ApprovalEngineService.compare("days", json("10"), ">=", json("\"abc\""))).isFalse();
    }

    @Test
    void nonNumeric_equalityFallsBackToStringCompare() {
        assertThat(ApprovalEngineService.compare("type", json("\"事假\""), "=", json("\"事假\""))).isTrue();
        assertThat(ApprovalEngineService.compare("type", json("\"事假\""), "=", json("\"病假\""))).isFalse();
        assertThat(ApprovalEngineService.compare("type", json("\"abc\""), "!=", json("\"10\""))).isTrue();
        assertThat(ApprovalEngineService.compare("type", json("\"abc\""), "≠", json("\"abc\""))).isFalse();
    }

    // ---------------- 空值 ----------------

    @Test
    void nullOperands_returnFalse() {
        assertThat(ApprovalEngineService.compare("days", null, "=", json("5"))).isFalse();
        assertThat(ApprovalEngineService.compare("days", MAPPER.nullNode(), "=", json("5"))).isFalse();
        assertThat(ApprovalEngineService.compare("days", json("5"), "=", null)).isFalse();
        assertThat(ApprovalEngineService.compare("days", json("\"\""), ">", json("5"))).isFalse();
    }
}
