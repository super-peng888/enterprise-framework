import { create } from 'zustand'
import { fetchMenus } from '@/api/system'
import type { MenuItem } from '@/mocks/system'

/**
 * 后端菜单 store：登录后由 RequireAuth 触发加载一次（token 变化强制重载），
 * 动态路由装配（App.tsx）与侧边栏（MainLayout）共用。
 * 接口失败时 fetchMenus 内部已降级到 mock 菜单，这里拿到的永远是可用列表。
 */
interface MenuState {
  /** 全量平铺菜单（含 dir/button，未按权限过滤） */
  menus: MenuItem[]
  loading: boolean
  loaded: boolean
  /** 加载菜单；force 用于菜单管理页增删改后即时刷新 */
  load: (force?: boolean) => Promise<void>
  reset: () => void
}

export const useMenuStore = create<MenuState>()((set, get) => ({
  menus: [],
  loading: false,
  loaded: false,
  load: async (force = false) => {
    const { loading, loaded } = get()
    if (loading || (loaded && !force)) return
    set({ loading: true })
    try {
      const menus = await fetchMenus()
      set({ menus, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  reset: () => set({ menus: [], loading: false, loaded: false }),
}))

/** 按 parentId 组树（子级按 sort 升序），返回顶级节点（parentId=0 或父级缺失的孤儿） */
export function buildMenuTree(flat: MenuItem[]): MenuItem[] {
  const byId = new Map<number, MenuItem>()
  flat.forEach((m) => byId.set(m.id, { ...m }))
  const roots: MenuItem[] = []
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) {
      parent.children = parent.children ?? []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sortRec = (nodes: MenuItem[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.id - b.id)
    nodes.forEach((n) => n.children && sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

/** 菜单可见性：perm 为空表示登录即可见，否则要求用户 perms 命中 */
export function menuVisible(menu: MenuItem, perms: string[]): boolean {
  return !menu.perm || perms.includes(menu.perm)
}
