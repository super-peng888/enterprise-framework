import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * 页面组件注册表：import.meta.glob 扫描 src/pages 下全部 .tsx，
 * 生成「组件地址 → 懒加载」映射，供后端菜单驱动的动态路由装配。
 *
 * 组件地址约定：菜单 path 存相对 src/pages 的组件文件路径（不带 pages/ 前缀，
 * 带 .tsx 后缀），如 system/users/Users.tsx；路由路径取其所在目录，
 * 即 system/users/Users.tsx → /system/users。
 */
const modules = import.meta.glob('../pages/**/*.tsx')

/** 归一化组件地址：去空白、去前导 /、容忍误带 pages/ 前缀 */
export function normalizeComponentPath(path: string): string {
  let p = path.trim().replace(/^\/+/, '')
  if (p.startsWith('pages/')) p = p.slice('pages/'.length)
  return p
}

/** 全部可选组件地址（菜单管理页「组件地址」下拉的数据源） */
export const pageComponentPaths: string[] = Object.keys(modules)
  .map((k) => k.replace(/^\.\.\/pages\//, ''))
  .sort()

/** 按组件地址解析懒加载组件；地址不在注册表（文件不存在）时返回 null */
export function resolvePageComponent(
  path: string,
): LazyExoticComponent<ComponentType<any>> | null {
  const loader = modules[`../pages/${normalizeComponentPath(path)}`]
  if (!loader) return null
  return lazy(loader as () => Promise<{ default: ComponentType<any> }>)
}

/** 组件地址 → 路由路径：取所在目录，如 system/users/Users.tsx → /system/users */
export function routePathOf(componentPath: string): string {
  const p = normalizeComponentPath(componentPath)
  const dir = p.split('/').slice(0, -1).join('/')
  return `/${dir}`
}
