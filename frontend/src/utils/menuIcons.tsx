import { createElement, type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import {
  Bell,
  ClipboardList,
  File,
  FileText,
  Folder,
  History,
  Home,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Lock,
  Send,
  Settings,
  ShieldCheck,
  User,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react'

/**
 * 菜单 icon 字段（lucide 图标名）→ 图标组件映射表。
 * 未命中（含空值）一律用 File 兜底，保证后端填错图标名时菜单不炸。
 */
const MENU_ICON_MAP: Record<string, LucideIcon> = {
  Bell,
  ClipboardList,
  File,
  FileText,
  Folder,
  History,
  Home,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Lock,
  Send,
  Settings,
  ShieldCheck,
  User,
  UserCog,
  Users,
  Workflow,
}

/** 菜单管理页「图标」下拉的常见图标建议（仍可手输任意 lucide 名） */
export const ICON_SUGGESTIONS: string[] = Object.keys(MENU_ICON_MAP).sort()

export function renderMenuIcon(name: string | null | undefined, size = 16): ReactNode {
  const Icon = (name && MENU_ICON_MAP[name]) || File
  return createElement(Icon, { size })
}
