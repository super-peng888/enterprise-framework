import { Button, Result } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { routePathOf } from '@/router/registry'
import { useAuthStore } from '@/stores/auth'
import { menuVisible, useMenuStore } from '@/stores/menu'

/**
 * MainLayout 下的兜底路由：
 * - 路径命中后端菜单但当前用户无该菜单权限 → 403；
 * - 其余未匹配路径 → 404。
 */
export default function RouteFallback() {
  const location = useLocation()
  const navigate = useNavigate()
  const menus = useMenuStore((s) => s.menus)
  const perms = useAuthStore((s) => s.perms)

  const matched = menus
    .filter((m) => m.type === 'menu' && m.path)
    .filter((m) => location.pathname.startsWith(routePathOf(m.path!)))
    .sort((a, b) => routePathOf(b.path!).length - routePathOf(a.path!).length)[0]
  const forbidden = matched ? !menuVisible(matched, perms) : false

  return (
    <Result
      status={forbidden ? '403' : '404'}
      title={forbidden ? '403' : '404'}
      subTitle={
        forbidden
          ? '没有访问该页面的权限，请联系管理员分配对应菜单权限。'
          : '页面不存在或已被移除。'
      }
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard', { replace: true })}>
          返回仪表盘
        </Button>
      }
    />
  )
}
