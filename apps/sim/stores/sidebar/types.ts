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
  /**
   * Re-applies the `--sidebar-width` CSS variable from current state, clamped to
   * the viewport. Self-heals cases where the variable was left at its `0px`
   * default (e.g. soft navigation) or grew wider than a now-smaller window.
   */
  syncWidth: () => void
  setHasHydrated: (hasHydrated: boolean) => void
}
