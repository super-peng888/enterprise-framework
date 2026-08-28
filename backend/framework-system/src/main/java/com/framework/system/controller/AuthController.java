package com.framework.system.controller;

import com.framework.common.constant.Constants;
import com.framework.common.error.ErrorCode;
import com.framework.common.result.Result;
import com.framework.system.dto.CurrentUserResponse;
import com.framework.system.dto.LoginRequest;
import com.framework.system.dto.LoginResponse;
import com.framework.system.entity.SysUser;
import com.framework.system.repository.SysMenuRepository;
import com.framework.system.repository.SysRoleRepository;
import com.framework.system.repository.SysUserRepository;
import com.framework.system.security.JwtService;
import com.framework.system.security.LoginUser;
import com.framework.system.service.LoginLogService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 认证接口。
 */
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final SysMenuRepository menuRepository;
    private final JwtService jwtService;
    private final LoginLogService loginLogService;
    private final BCryptPasswordEncoder passwordEncoder;

    /**
     * 登录入口，两种入参共用同一接口：
     * 1) 账号密码：{username, password}，用户名全局唯一（查不到按真实姓名兜底），
     *    校验 sys_user.password（BCrypt）后签发 JWT；
     * 2) 飞书扫码：{code}，本期为 mock 占位（code 传 "mock" 时以种子用户 admin 签发 JWT）。
     */
    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest req, HttpServletRequest request) {
        String ip = clientIp(request);
        String ua = request.getHeader("User-Agent");

        // 分支一：账号密码登录
        if (StringUtils.hasText(req.getUsername())) {
            return loginByPassword(req, ip, ua);
        }

        // 分支二：飞书扫码（本期 mock 占位）
        if (!"mock".equals(req.getCode())) {
            loginLogService.record(null, null, ip, ua, false,
                    "非 mock code：飞书换 token 流程尚未接入");
            return Result.fail(ErrorCode.LOGIN_FAILED);
        }

        SysUser user = userRepository.findByUsername("admin").orElse(null);
        if (user == null || user.getStatus() == null
                || user.getStatus() != Constants.USER_STATUS_ENABLED) {
            loginLogService.record(user == null ? null : user.getId(), "admin", ip, ua, false,
                    "用户不存在或已禁用/离职");
            return Result.fail(ErrorCode.USER_DISABLED);
        }

        String token = jwtService.generate(user.getId(), user.getUsername(), user.getRealName());
        loginLogService.record(user.getId(), user.getUsername(), ip, ua, true, "mock 登录成功");
        return Result.ok(new LoginResponse(token, Constants.TOKEN_TYPE));
    }

    /**
     * 账号密码登录：用户名全局唯一，查不到按真实姓名兜底；
     * 用户不存在 / 密码错误 / 已禁用统一返回 401「用户名或密码错误」，
     * 不对外暴露具体原因；成功/失败均落 sys_login_log。
     */
    private Result<LoginResponse> loginByPassword(LoginRequest req, String ip, String ua) {
        SysUser user = userRepository.findByUsername(req.getUsername())
                .orElseGet(() -> userRepository.findByRealName(req.getUsername()).orElse(null));

        boolean enabled = user != null && user.getStatus() != null
                && user.getStatus() == Constants.USER_STATUS_ENABLED;
        if (!enabled || !StringUtils.hasText(user.getPassword())
                || !passwordEncoder.matches(req.getPassword() == null ? "" : req.getPassword(),
                        user.getPassword())) {
            loginLogService.record(user == null ? null : user.getId(), req.getUsername(), ip, ua,
                    false, "账号密码登录失败：用户名或密码错误");
            return Result.fail(ErrorCode.UNAUTHORIZED.getCode(), "用户名或密码错误");
        }

        String token = jwtService.generate(user.getId(), user.getUsername(), user.getRealName());
        loginLogService.record(user.getId(), user.getUsername(), ip, ua, true, "账号密码登录成功");
        return Result.ok(new LoginResponse(token, Constants.TOKEN_TYPE));
    }

    /**
     * 当前登录用户信息：基本信息 + 角色编码 + 权限点。
     */
    @GetMapping("/me")
    public Result<CurrentUserResponse> me(@AuthenticationPrincipal LoginUser loginUser) {
        SysUser user = userRepository.findById(loginUser.id()).orElse(null);
        if (user == null) {
            return Result.fail(ErrorCode.USER_DISABLED);
        }
        List<String> roles = roleRepository.findRoleCodesByUserId(user.getId());
        List<String> perms = menuRepository.findPermsByUserId(user.getId());
        return Result.ok(new CurrentUserResponse(user, roles, perms));
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
