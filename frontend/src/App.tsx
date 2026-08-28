import { Suspense, useEffect, useMemo } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { App as AntdApp, ConfigProvider, Spin, theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import MainLayout from '@/layouts/MainLayout'
import RequireAuth from '@/router/RequireAuth'
import RouteFallback from '@/router/RouteFallback'
import { resolvePageComponent, routePathOf } from '@/router/registry'
import Login from '@/pages/login/Login'
import { useAuthStore } from '@/stores/auth'
import { menuVisible, useMenuStore } from '@/stores/menu'
import { useThemeStore, type ThemeKey } from '@/stores/theme'

/** 懒加载页面组件的占位（与菜单加载同风格的全屏 Spin） */
const pageFallback = (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Spin size="large" />
  </div>
)

/** 两套主题（浅色 cool / 深色 dark）token：与 src/styles/themes.css 的 CSS 变量一一对应 */
const ANTD_THEMES: Record<ThemeKey, ThemeConfig> = {
  cool: {
    cssVar: {},
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      // 全局字体：筑梦黑（antd 6 默认栈含 Noto Sans SC 会覆盖 body，必须用 token 指定）
      fontFamily:
        "'Dream Han Sans CN', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      // 主色为近黑深色：主按钮深底白字，链接/强调色同步走中性深色（无紫）
      colorPrimary: '#1f2124',
      colorInfo: '#1f2124',
      colorPrimaryHover: '#2a2d31',
      colorPrimaryActive: '#17181a',
      borderRadius: 12,
      fontSize: 13,
      colorTextHeading: '#101828',
      colorText: '#475467',
      colorTextSecondary: '#98a2b3',
      colorBgLayout: '#f0f0f0',
      colorBgContainer: '#ffffff',
      colorBorder: '#e9edf0',
      colorBorderSecondary: '#eef1f4',
      colorSuccess: '#0d9f6e',
      colorWarning: '#d97706',
      colorError: '#e5484d',
      colorBgElevated: 'rgba(255, 255, 255, 0.94)',
      boxShadowTertiary:
        '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.05)',
    },
    components: {
      Table: {
        headerBg: '#f9fafb',
        headerColor: '#344054',
        rowHoverBg: 'rgba(0, 0, 0, 0.03)',
      },
    },
  },
  dark: {
    cssVar: {},
    algorithm: antdTheme.darkAlgorithm,
    token: {
      fontFamily:
        "'Dream Han Sans CN', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      // 深色下主色反转：浅底深字（colorTextLightSolid 为压在其上的文字/勾选色）
      colorPrimary: '#eceef2',
      colorInfo: '#eceef2',
      colorPrimaryHover: '#ffffff',
      colorPrimaryActive: '#d5d9df',
      colorTextLightSolid: '#17181a',
      borderRadius: 12,
      fontSize: 13,
      colorTextHeading: '#eef0fa',
      colorText: '#b8bdd6',
      colorTextSecondary: '#6f7594',
      colorBgLayout: '#14161a',
      colorBgContainer: '#1b1e25',
      colorSuccess: '#34c694',
      colorWarning: '#eba94c',
      colorError: '#f06a6e',
      colorBgElevated: '#22262e',
      colorBorder: 'rgba(255, 255, 255, 0.12)',
      colorBorderSecondary: 'rgba(255, 255, 255, 0.07)',
      boxShadowTertiary: '0 8px 32px 0 rgba(0, 0, 0, 0.35), 0 2px 8px 0 rgba(0, 0, 0, 0.2)',
    },
    components: {
      Table: {
        headerBg: 'rgba(255, 255, 255, 0.04)',
        headerColor: '#b8bdd6',
        rowHoverBg: 'rgba(255, 255, 255, 0.05)',
      },
    },
  },
}

export default function App() {
  const themeKey = useThemeStore((s) => s.themeKey)
  const menus = useMenuStore((s) => s.menus)
  const perms = useAuthStore((s) => s.perms)

  // 把主题写到 <html data-theme>，themes.css 按属性选择器切换全套 CSS 变量
  useEffect(() => {
    document.documentElement.dataset.theme = themeKey
  }, [themeKey])

  /**
   * 动态路由装配：后端菜单中 type=menu 且当前用户有权限的项，
   * 按组件地址（registry 注册表）懒加载挂到 MainLayout children 下。
   * /dashboard 不再静态保留，同样走菜单（dashboard/Dashboard.tsx，perm 为空即登录可见），
   * 理由：路由与菜单单一数据源，新增页面只需配菜单；静态仅保留 /login 与 index 重定向。
   */
  const dynamicRoutes = useMemo(
    () =>
      menus
        .filter((m) => m.type === 'menu' && m.path && menuVisible(m, perms))
        .map((m) => {
          const Comp = resolvePageComponent(m.path!)
          if (!Comp) {
            console.warn(`[router] 菜单「${m.title}」组件地址未命中注册表: ${m.path}`)
            return null
          }
          return (
            <Route
              key={m.id}
              path={routePathOf(m.path!).slice(1)}
              element={<Suspense fallback={pageFallback}>{<Comp />}</Suspense>}
            />
          )
        }),
    [menus, perms],
  )

  return (
    <ConfigProvider locale={zhCN} theme={ANTD_THEMES[themeKey]}>
      <AntdApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <MainLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              {dynamicRoutes}
              {/* 兜底：命中菜单但无权限 → 403；其余 → 404 */}
              <Route path="*" element={<RouteFallback />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  )
}
