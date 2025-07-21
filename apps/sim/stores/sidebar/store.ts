import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  // Track workspace dropdown state
  workspaceDropdownOpen: boolean
  // Control workspace dropdown state
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      workspaceDropdownOpen: false, // Track if workspace dropdown is open
      // Only update dropdown state
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
    }),
    {
      name: 'sidebar-state',
    }
  )
)
