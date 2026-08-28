/**
 * 主题切换：两套主题（浅色 cool / 深色 dark）。
 * zustand + persist 持久化到 localStorage；App 启动时把 themeKey
 * 写到 document.documentElement 的 data-theme 属性上，
 * src/styles/themes.css 按 [data-theme='...'] 覆盖全套 CSS 变量，
 * antd 侧由 App.tsx 按 themeKey 切换 algorithm 与 token。
 * 兼容：历史版本存在暖色 warm 主题，localStorage 残留的 warm 值迁移回 cool。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeKey = 'cool' | 'dark'

interface ThemeState {
  themeKey: ThemeKey
  setTheme: (key: ThemeKey) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeKey: 'cool',
      setTheme: (themeKey) => set({ themeKey }),
    }),
    {
      name: 'ef-theme', // localStorage key
      version: 1,
      // v0 -> v1：移除 warm 主题，残留值（及任何非法值）回退 cool
      migrate: (persisted) => {
        const state = persisted as { themeKey?: string } | undefined
        if (state && state.themeKey !== 'cool' && state.themeKey !== 'dark') {
          state.themeKey = 'cool'
        }
        return state as ThemeState
      },
    },
  ),
)
