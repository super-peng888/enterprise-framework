import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Dropdown, Menu } from 'antd'
import type { MenuProps } from 'antd'
import {
  LogOut,
  Maximize,
  Minimize,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react'
import { routePathOf } from '@/router/registry'
import { useAuthStore } from '@/stores/auth'
import { buildMenuTree, menuVisible, useMenuStore } from '@/stores/menu'
import { useThemeStore } from '@/stores/theme'
import { renderMenuIcon } from '@/utils/menuIcons'
import NotificationBell from '@/components/NotificationBell'
import './MainLayout.css'

type AntdMenuItem = Required<MenuProps>['items'][number]

const ICON_SIZE = 16

/** 面包屑默认兜底（菜单加载前/未命中时不至于空白） */
const DEFAULT_ROUTE_META = { path: '/dashboard', group: '工作台', label: '仪表盘' }

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { userName, realName, perms, logout } = useAuthStore()
  const menus = useMenuStore((s) => s.menus)
  const { themeKey, setTheme } = useThemeStore()

  // Header 账号区展示真实姓名，未取到（历史会话/离线演示）回退登录账号
  const displayName = realName || userName || '演示用户'

  /**
   * 侧边栏菜单：后端菜单树渲染。目录（type=dir）→ antd group 分组，
   * 菜单（type=menu）→ 分组内项；按钮不进入侧边栏；按用户 perms 过滤。
   * 未挂目录的顶级菜单归入「其他」组。
   */
  const menuItems = useMemo<AntdMenuItem[]>(() => {
    const tree = buildMenuTree(
      menus.filter((m) => m.type !== 'button' && menuVisible(m, perms)),
    )
    const toLeaf = (c: (typeof tree)[number]) => ({
      key: routePathOf(c.path!),
      icon: renderMenuIcon(c.icon, ICON_SIZE),
      label: c.title,
    })
    const groups: AntdMenuItem[] = tree
      .filter((n) => n.type === 'dir')
      .map((dir) => ({
        type: 'group' as const,
        label: dir.title,
        children: (dir.children ?? [])
          .filter((c) => c.type === 'menu' && c.path)
          .map(toLeaf),
      }))
      .filter((g: any) => g.children.length > 0)
    const orphans = tree.filter((n) => n.type === 'menu' && n.path)
    if (orphans.length > 0) {
      groups.push({ type: 'group', label: '其他', children: orphans.map(toLeaf) })
    }
    return groups
  }, [menus, perms])

  /** 路由 -> 面包屑（目录名 / 菜单名）映射，由后端菜单展开 */
  const routeMeta = useMemo(() => {
    return menus
      .filter((m) => m.type === 'menu' && m.path)
      .map((m) => ({
        path: routePathOf(m.path!),
        group: menus.find((p) => p.id === m.parentId)?.title ?? '菜单',
        label: m.title,
      }))
  }, [menus])

  // 当前路由匹配的菜单项（selectedKey 与面包屑共用同一份匹配结果）
  const currentRoute = useMemo(() => {
    return (
      routeMeta
        .filter((r) => location.pathname.startsWith(r.path))
        .sort((a, b) => b.path.length - a.path.length)[0] ?? DEFAULT_ROUTE_META
    )
  }, [location.pathname, routeMeta])

  // 菜单搜索：按页面名过滤，保留有命中项的分组
  const filteredMenuItems = useMemo(() => {
    const q = menuQuery.trim().toLowerCase()
    if (!q) return menuItems
    return menuItems
      .map((g: any) => ({
        ...g,
        children: (g.children ?? []).filter((c: any) =>
          String(c.label).toLowerCase().includes(q),
        ),
      }))
      .filter((g: any) => g.children.length > 0)
  }, [menuQuery, menuItems])

  // 全屏状态跟踪（Esc 退出也要同步图标）
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={`main-layout ${collapsed ? 'is-collapsed' : ''}`}>
      {/* 环境光晕背景层（仅 dark 渲染） */}
      <div className="ambient-glows" aria-hidden>
        <span className="glow glow-1" />
        <span className="glow glow-2" />
        <span className="glow glow-3" />
        <span className="glow glow-4" />
        <span className="glow glow-5" />
      </div>

      <aside className="sidebar">
        {/* Logo 区：高度与 body 顶栏一致，胶囊形态 */}
        <div className="sidebar-logo" onClick={() => navigate('/dashboard')}>
          <span className="logo-pill">
            <span className="logo-pill-icon">
              <Sparkles size={14} />
            </span>
            {!collapsed && <span className="logo-pill-text">EF Admin</span>}
          </span>
        </div>

        {/* 分割线：与 body 顶栏底部分割线同高对齐 */}
        <div className="sidebar-divider" />

        {!collapsed && (
          <div className="sidebar-search">
            <Search size={14} className="sidebar-search-icon" />
            <input
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
              placeholder="搜索菜单"
              aria-label="搜索菜单"
            />
          </div>
        )}

        <div className="sidebar-menu">
          <Menu
            mode="inline"
            inlineCollapsed={collapsed}
            items={filteredMenuItems}
            selectedKeys={[currentRoute.path]}
            onClick={({ key }) => navigate(key)}
          />
        </div>

        {/* 底部 Settings：钉在 sidebar 底部，样式同菜单项（占位，暂无动作） */}
        <div className="sidebar-footer">
          <button type="button" className="sidebar-settings" aria-label="系统设置">
            <Settings size={ICON_SIZE} />
            {!collapsed && <span>系统设置</span>}
          </button>
        </div>
      </aside>

      {/* body：灰底上浮起的白色圆角大卡 */}
      <div className="main-body">
        <header className="header">
          <div className="header-left">
            <button
              type="button"
              className="header-icon-btn"
              onClick={() => setCollapsed((v) => !v)}
              aria-label="折叠菜单"
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <nav className="header-breadcrumb" aria-label="面包屑">
              <span className="crumb-group">{currentRoute.group}</span>
              <span className="crumb-sep">/</span>
              <span className="crumb-page">{currentRoute.label}</span>
            </nav>
          </div>

          <div className="header-right">
            {/* 主题切换：单按钮在浅色/深色间切换 */}
            <button
              type="button"
              className="header-icon-btn"
              onClick={() => setTheme(themeKey === 'dark' ? 'cool' : 'dark')}
              aria-label="切换主题"
            >
              {themeKey === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'identity',
                    label: displayName,
                    disabled: true,
                  },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogOut size={14} />, label: '退出登录', danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') handleLogout()
                },
              }}
              trigger={['click']}
            >
              <div className="header-account">
                <Avatar size={32} className="header-avatar">
                  {displayName.slice(0, 1)}
                </Avatar>
                <span className="header-account-name">{displayName}</span>
              </div>
            </Dropdown>
            <NotificationBell />
            <button
              type="button"
              className="header-icon-btn"
              onClick={toggleFullscreen}
              aria-label="全屏切换"
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </header>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
