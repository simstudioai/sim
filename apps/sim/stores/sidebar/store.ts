import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Sidebar state interface
 */
interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
}

/**
 * Sidebar width constraints
 * Note: Maximum width is enforced dynamically at 30% of viewport width in the resize hook
 */
const DEFAULT_SIDEBAR_WIDTH = 232
const MIN_SIDEBAR_WIDTH = 232

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        // Only enforce minimum - maximum is enforced dynamically by the resize hook
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, width)
        set({ sidebarWidth: clampedWidth })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', `${clampedWidth}px`)
        }
      },
    }),
    {
      name: 'sidebar-state',
      onRehydrateStorage: () => (state) => {
        // Validate and enforce constraints after rehydration
        if (state && typeof window !== 'undefined') {
          // Sync CSS variables with validated state
          document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`)
        }
      },
    }
  )
)
