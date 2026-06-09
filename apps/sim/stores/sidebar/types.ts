/**
 * Sidebar state interface
 */
export interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  /** Whether the sidebar menu is hidden (fully collapsed to zero width) */
  isCollapsed: boolean
  /** Whether the hover flyout menu is showing while the sidebar is collapsed */
  isFlyoutOpen: boolean
  _hasHydrated: boolean
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
  /** Toggles sidebar between collapsed and expanded states */
  toggleCollapsed: () => void
  /** Shows the hover flyout immediately, cancelling any pending close */
  openFlyout: () => void
  /** Hides the hover flyout after a short grace period (cursor crossing gaps) */
  scheduleFlyoutClose: () => void
  /** Hides the hover flyout immediately */
  closeFlyout: () => void
  /**
   * Pins the flyout open while a popup launched from inside it (workspace
   * menu, context menu) is showing — its portal renders outside the flyout, so
   * hover-leave must not dismiss the flyout underneath. Unpinning closes the
   * flyout if the cursor has already left it.
   */
  setFlyoutPinned: (pinned: boolean) => void
  /**
   * Re-applies the `--sidebar-width` CSS variable from current state, clamped to
   * the viewport. Self-heals cases where the variable was left at its `0px`
   * default (e.g. soft navigation) or grew wider than a now-smaller window.
   */
  syncWidth: () => void
  setHasHydrated: (hasHydrated: boolean) => void
}
