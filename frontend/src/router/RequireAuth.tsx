import { useEffect, useRef, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '@/stores/auth'
import { useMenuStore } from '@/stores/menu'

/**
 * 路由守卫：
 * 1. 无 token 一律跳转登录页；
 * 2. 有 token 则先拉取后端菜单（动态路由与侧边栏的数据源），
 *    拉取期间全屏 loading；接口失败时 api 层已降级 mock 菜单，不会卡死。
 * 3. token 变化（重新登录/切换账号）强制重拉菜单；登出时清空菜单缓存。
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const location = useLocation()
  const loaded = useMenuStore((s) => s.loaded)
  const permsLoaded = useAuthStore((s) => s.permsLoaded)
  const syncPerms = useAuthStore((s) => s.syncPerms)
  const load = useMenuStore((s) => s.load)
  const reset = useMenuStore((s) => s.reset)
  const prevToken = useRef<string | null>(null)

  useEffect(() => {
    if (!token) {
      prevToken.current = null
      reset()
      return
    }
    // 同一 token 重复挂载不重拉（load 内部有 loaded 守卫）；token 变了强制刷新菜单和权限点
    const force = prevToken.current !== token
    prevToken.current = token
    load(force)
    if (force || !permsLoaded) {
      // persist 恢复的 perms 可能过期（角色调整/外部注入 token），token 变化时一律重同步
      syncPerms()
    }
  }, [token, load, reset, permsLoaded, syncPerms])

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!loaded || !permsLoaded) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin size="large" description="正在加载菜单...">
          <div style={{ width: 200, height: 60 }} />
        </Spin>
      </div>
    )
  }
  return <>{children}</>
}
