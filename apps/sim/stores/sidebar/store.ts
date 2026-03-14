import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import type { SidebarState } from './types'

function applySidebarWidth(width: number) {
  if (typeof window !== 'undefined') {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
  }
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: SIDEBAR_WIDTH.DEFAULT,
      isCollapsed: false,
      isResizing: false,
      _hasHydrated: false,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        if (get().isCollapsed) return
        const clampedWidth = Math.max(SIDEBAR_WIDTH.MIN, width)
        set({ sidebarWidth: clampedWidth })
        applySidebarWidth(clampedWidth)
      },
      toggleCollapsed: () => {
        const { isCollapsed, sidebarWidth } = get()
        const nextCollapsed = !isCollapsed
        set({ isCollapsed: nextCollapsed })
        applySidebarWidth(nextCollapsed ? SIDEBAR_WIDTH.COLLAPSED : sidebarWidth)
      },
      setIsResizing: (isResizing) => {
        set({ isResizing })
      },
      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
    }),
    {
      name: 'sidebar-state',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true)
          const width = state.isCollapsed ? SIDEBAR_WIDTH.COLLAPSED : state.sidebarWidth
          applySidebarWidth(width)
        }
      },
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        isCollapsed: state.isCollapsed,
      }),
    }
  )
)
