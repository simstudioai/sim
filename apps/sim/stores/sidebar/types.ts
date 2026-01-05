/**
 * Sidebar state interface
 */
export interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  isCollapsed: boolean
  _hasHydrated: boolean
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
  setIsCollapsed: (isCollapsed: boolean) => void
  setHasHydrated: (hasHydrated: boolean) => void
}
