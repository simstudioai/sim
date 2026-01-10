/**
 * Sidebar state interface
 */
export interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  isCollapsed: boolean
  /** Whether the sidebar is currently being resized */
  isResizing: boolean
  _hasHydrated: boolean
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
  setIsCollapsed: (isCollapsed: boolean) => void
  /** Updates the sidebar resize state */
  setIsResizing: (isResizing: boolean) => void
  setHasHydrated: (hasHydrated: boolean) => void
}
