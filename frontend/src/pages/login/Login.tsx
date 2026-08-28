import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Form, Input } from 'antd'
import { QrCode, Sparkles } from 'lucide-react'
import request from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import './Login.css'

interface LoginForm {
  username: string
  password: string
}

/** 后端 Result 包装：失败时 msg/message 都兼容（契约返回 code=401 msg=用户名或密码错误） */
function resultMsg(data: unknown, fallback: string): string {
  const r = data as { msg?: string; message?: string } | undefined
  return r?.msg || r?.message || fallback
}

export default function Login() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { token, login, syncMe } = useAuthStore()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (token) {
      navigate('/dashboard', { replace: true })
    }
  }, [token, navigate])

  /** 账号密码登录：/auth/login 换 token → /auth/me 取身份（username + realName）→ 进首页 */
  const handlePasswordLogin = async (values: LoginForm) => {
    setSubmitting(true)
    try {
      const res = await request.post('/system/auth/login', {
        username: values.username,
        password: values.password,
      })
      const loginData = (res as { data?: { token?: string } })?.data
      const realToken = loginData?.token
      if (!realToken) {
        message.error(resultMsg(res, '登录失败'))
        return
      }
      const me = await request.get('/system/auth/me', {
        headers: { Authorization: `Bearer ${realToken}` },
      })
      const meData = (me as {
        data?: {
          user?: { username?: string; realName?: string }
          perms?: string[]
        }
      })?.data
      const meUser = meData?.user
      login(realToken, meUser?.username ?? values.username, meUser?.realName)
      syncMe({ perms: meData?.perms })
      navigate('/dashboard', { replace: true })
    } catch (e: any) {
      // 后端可达但拒绝（401）：提示后端返回的 msg；不可达则提示降级入口
      const data = e?.response?.data
      message.error(
        e?.response
          ? resultMsg(data, '登录失败')
          : '后端服务不可达，可使用下方「离线演示模式」进入',
      )
    } finally {
      setSubmitting(false)
    }
  }

  /** 离线演示：后端不可达时的降级入口，直接写入本地 mock token */
  const handleMockLogin = () => {
    login(`mock-token-${Date.now()}`, 'demo', '演示用户')
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="login-page">
      {/* 环境光晕背景层 */}
      <div className="ambient-glows" aria-hidden>
        <span className="glow glow-1" />
        <span className="glow glow-2" />
        <span className="glow glow-3" />
        <span className="glow glow-4" />
        <span className="glow glow-5" />
      </div>

      <div className="login-brand">
        <div className="login-brand-logo">
          <span className="login-brand-logo-icon">
            <Sparkles size={22} color="#fff" />
          </span>
          <span className="login-brand-logo-text">EF Admin</span>
        </div>
        <h2 className="login-brand-slogan">
          一套框架
          <br />
          撑起企业后台
        </h2>
        <p className="login-brand-sub">
          EF Admin 企业级管理框架 · RBAC / 审批引擎 / 表单与流程设计器开箱即用
        </p>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <h3 className="login-card-title">欢迎登录</h3>
          <p className="login-card-sub">EF Admin 企业级管理框架</p>

          {/* 扫码登录占位：真实企业 IM 接入后再启用 */}
          <div className="login-qrcode">
            <QrCode size={56} strokeWidth={1.2} color="var(--icon-muted)" />
            <span className="login-qrcode-text">使用企业 IM 扫码登录</span>
          </div>
          <p className="login-qrcode-tip">员工离职注销企业账号后将无法登录</p>

          <div className="login-divider">
            <span>或使用账号密码登录</span>
          </div>

          <Form<LoginForm> layout="vertical" onFinish={handlePasswordLogin} requiredMark={false}>
            <Form.Item
              name="username"
              label="账号"
              rules={[{ required: true, message: '请输入账号' }]}
            >
              <Input size="large" placeholder="请输入账号" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password size="large" placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" size="large" block htmlType="submit" loading={submitting}>
                登 录
              </Button>
            </Form.Item>
          </Form>

          <p className="login-demo-hint">
            演示账号：admin / zhangsan / lisi，密码均为 123456
          </p>
          <p className="login-offline">
            <button type="button" className="login-offline-link" onClick={handleMockLogin}>
              离线演示模式
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
