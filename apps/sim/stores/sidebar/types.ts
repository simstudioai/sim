/**
 * Sidebar state interface
 */
export interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  /** Whether the sidebar is collapsed to icon-only mode */
  isCollapsed: boolean
  _hasHydrated: boolean
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
  /** Toggles sidebar between collapsed and expanded states */
  toggleCollapsed: () => void
  setHasHydrated: (hasHydrated: boolean) => void
}
