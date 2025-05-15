import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SidebarMode = 'expanded' | 'collapsed' | 'hover'

interface SidebarState {
  mode: SidebarMode
  isExpanded: boolean
  // Track workspace dropdown state
  workspaceDropdownOpen: boolean
  // Track if any modal is open
  isAnyModalOpen: boolean
  setMode: (mode: SidebarMode) => void
  toggleExpanded: () => void
  // Control workspace dropdown state
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  // Control modal state
  setAnyModalOpen: (isOpen: boolean) => void
  // Force sidebar expanded state without triggering loops
  forceExpanded: (expanded: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      mode: 'expanded', // Default to expanded mode
      isExpanded: true, // Default to expanded state
      workspaceDropdownOpen: false, // Track if workspace dropdown is open
      isAnyModalOpen: false, // Track if any modal is open
      setMode: (mode) => set({ mode }),
      toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
      // Only update dropdown state without changing isExpanded
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      // Update modal state
      setAnyModalOpen: (isOpen) => set({ isAnyModalOpen: isOpen }),
      // Separate function to control expanded state
      forceExpanded: (expanded) => set({ isExpanded: expanded }),
    }),
    {
      name: 'sidebar-state',
    }
  )
)
