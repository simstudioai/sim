import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import type { SidebarState } from './types'

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: SIDEBAR_WIDTH.DEFAULT,
      isResizing: false,
      _hasHydrated: false,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        const clampedWidth = Math.max(SIDEBAR_WIDTH.MIN, width)
        set({ sidebarWidth: clampedWidth })
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', `${clampedWidth}px`)
        }
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
          if (typeof window !== 'undefined') {
            document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`)
          }
        }
      },
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
      }),
    }
  )
)
