import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import type { SidebarState } from './types'

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
        // Only enforce minimum - maximum is enforced dynamically by the resize hook
        const clampedWidth = Math.max(SIDEBAR_WIDTH.MIN, width)
        set({ sidebarWidth: clampedWidth })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', `${clampedWidth}px`)
        }
      },
      setIsCollapsed: (isCollapsed) => {
        set({ isCollapsed })
        // Set width to 0 when collapsed (floating UI doesn't need sidebar space)
        if (isCollapsed && typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', '0px')
        } else if (!isCollapsed && typeof window !== 'undefined') {
          // Restore to stored width when expanding
          const currentWidth = get().sidebarWidth
          document.documentElement.style.setProperty('--sidebar-width', `${currentWidth}px`)
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
        // Mark store as hydrated and apply CSS variables
        if (state) {
          state.setHasHydrated(true)
          if (typeof window !== 'undefined') {
            const width = state.isCollapsed ? 0 : state.sidebarWidth
            document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
          }
        }
      },
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        isCollapsed: state.isCollapsed,
      }),
    }
  )
)
