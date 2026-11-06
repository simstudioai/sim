/**
 * Sidebar state interface
 */
export type SidebarSurface = 'workspace' | 'organization'

export interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  /** The width dragged on the organization rail; null until then. It never moves the workspace rail. */
  organizationSidebarWidth: number | null
  /** Which rail is mounted, so width reads and writes land on that rail's saved width. */
  surface: SidebarSurface
  /** Current expanded layout width; the saved desktop preference remains sidebarWidth. */
  renderedSidebarWidth: number
  /** Whether the sidebar is collapsed to icon-only mode */
  isCollapsed: boolean
  _hasHydrated: boolean
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
  setSurface: (surface: SidebarSurface) => void
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
