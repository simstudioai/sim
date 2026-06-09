import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import type { SidebarState } from './types'

/**
 * Clamps an expanded sidebar width into the valid range for the current
 * viewport. The upper bound can never drop below {@link SIDEBAR_WIDTH.MIN}, so a
 * narrow window (where `innerWidth * MAX_PERCENTAGE < MIN`) still yields a width
 * at or above the minimum instead of collapsing the sidebar to nothing.
 */
function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH.DEFAULT
  const max =
    typeof window === 'undefined'
      ? Number.POSITIVE_INFINITY
      : Math.max(SIDEBAR_WIDTH.MIN, window.innerWidth * SIDEBAR_WIDTH.MAX_PERCENTAGE)
  return Math.min(Math.max(width, SIDEBAR_WIDTH.MIN), max)
}

function applySidebarWidth(width: number) {
  if (typeof window === 'undefined') return
  const value = Number.isFinite(width) ? width : SIDEBAR_WIDTH.DEFAULT
  document.documentElement.style.setProperty('--sidebar-width', `${value}px`)
}

/** Grace period before the hover flyout hides, so the cursor can cross gaps. */
const FLYOUT_CLOSE_DELAY_MS = 180

let flyoutCloseTimer: ReturnType<typeof setTimeout> | null = null

/**
 * While true, hover-leave is ignored — set when a popup (e.g. the workspace
 * menu) opened from inside the flyout renders in a portal outside it, so
 * moving the cursor into that popup doesn't dismiss the flyout underneath.
 */
let flyoutPinned = false

/** Last hover state of the flyout/trigger, so unpinning knows whether to close. */
let flyoutPointerInside = false

function clearFlyoutCloseTimer() {
  if (flyoutCloseTimer !== null) {
    clearTimeout(flyoutCloseTimer)
    flyoutCloseTimer = null
  }
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: SIDEBAR_WIDTH.DEFAULT,
      isCollapsed: false,
      isFlyoutOpen: false,
      _hasHydrated: false,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        if (get().isCollapsed) return
        const clampedWidth = clampSidebarWidth(width)
        set({ sidebarWidth: clampedWidth })
        applySidebarWidth(clampedWidth)
      },
      toggleCollapsed: () => {
        const { isCollapsed, sidebarWidth } = get()
        const nextCollapsed = !isCollapsed
        clearFlyoutCloseTimer()
        flyoutPinned = false
        set({ isCollapsed: nextCollapsed, isFlyoutOpen: false })
        applySidebarWidth(nextCollapsed ? SIDEBAR_WIDTH.COLLAPSED : clampSidebarWidth(sidebarWidth))
      },
      openFlyout: () => {
        flyoutPointerInside = true
        clearFlyoutCloseTimer()
        set({ isFlyoutOpen: true })
      },
      scheduleFlyoutClose: () => {
        flyoutPointerInside = false
        clearFlyoutCloseTimer()
        if (flyoutPinned) return
        flyoutCloseTimer = setTimeout(() => set({ isFlyoutOpen: false }), FLYOUT_CLOSE_DELAY_MS)
      },
      closeFlyout: () => {
        clearFlyoutCloseTimer()
        flyoutPinned = false
        set({ isFlyoutOpen: false })
      },
      setFlyoutPinned: (pinned) => {
        flyoutPinned = pinned
        if (pinned) {
          clearFlyoutCloseTimer()
          return
        }
        if (!flyoutPointerInside && get().isFlyoutOpen) {
          clearFlyoutCloseTimer()
          flyoutCloseTimer = setTimeout(() => set({ isFlyoutOpen: false }), FLYOUT_CLOSE_DELAY_MS)
        }
      },
      syncWidth: () => {
        const { isCollapsed, sidebarWidth } = get()
        if (isCollapsed) {
          applySidebarWidth(SIDEBAR_WIDTH.COLLAPSED)
          return
        }
        const clampedWidth = clampSidebarWidth(sidebarWidth)
        if (clampedWidth !== sidebarWidth) set({ sidebarWidth: clampedWidth })
        applySidebarWidth(clampedWidth)
      },
      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
    }),
    {
      name: 'sidebar-state',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true)
          const width = state.isCollapsed
            ? SIDEBAR_WIDTH.COLLAPSED
            : clampSidebarWidth(state.sidebarWidth)
          applySidebarWidth(width)
          if (typeof document !== 'undefined') {
            document.documentElement.removeAttribute('data-sidebar-collapsed')
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
