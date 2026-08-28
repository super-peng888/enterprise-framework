import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** /auth/me 下发的权限信息 */
export interface MeProfile {
  /** 权限点列表，如 system:user:manage */
  perms?: string[]
}

interface AuthState {
  token: string | null
  /** 登录账号（如 admin / zhangsan），仅作身份记录，展示与按人查询都用 realName */
  userName: string | null
  /** 真实姓名（如 张三），网关注入下游的 X-User-Name 与审批/通知按人过滤的口径 */
  realName: string | null
  /** 权限点（auth/me 的 perms），菜单按权限点显隐 */
  perms: string[]
  /** perms 是否已从 /auth/me 同步过（persist 恢复的旧 perms 可能过期，token 变化时会强制重同步） */
  permsLoaded: boolean
  login: (token: string, userName: string, realName?: string) => void
  /** 登录后 /auth/me 同步权限信息 */
  syncMe: (me: MeProfile) => void
  /** 拉取 /auth/me 刷新 perms（token 有效但 persist 的 perms 过期/为空时调用） */
  syncPerms: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userName: null,
      realName: null,
      perms: [],
      permsLoaded: false,
      // realName 未传时保留旧值（persist 的旧数据没有该字段，兼容历史会话）
      login: (token, userName, realName) =>
        set((state) => ({
          token,
          userName,
          realName: realName !== undefined ? realName : state.realName,
        })),
      syncMe: (me) =>
        set((state) => ({
          perms: me.perms ?? state.perms,
          permsLoaded: true,
        })),
      syncPerms: async () => {
        try {
          const { default: request } = await import('@/api/request')
          const res = await request.get('/system/auth/me')
          const data = (res as { data?: { perms?: string[] } })?.data ?? (res as { perms?: string[] })
          set({ perms: data?.perms ?? [], permsLoaded: true })
        } catch {
          // 接口失败不覆盖现有 perms，但标记已尝试（避免无限阻塞；mock 环境下 perms 由 mock 登录写入）
          set({ permsLoaded: true })
        }
      },
      logout: () =>
        set({ token: null, userName: null, realName: null, perms: [], permsLoaded: false }),
    }),
    {
      name: 'ef-auth', // localStorage key
    },
  ),
)
