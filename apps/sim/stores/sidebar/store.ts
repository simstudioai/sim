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

/**
 * Publishes both sidebar widths, owning the collapsed mapping so callers don't repeat it.
 *
 * `--sidebar-width` is the width the rail currently occupies (the collapsed width while
 * collapsed), whereas `--sidebar-expanded-width` always holds the width to restore to.
 * The desktop hover-peek needs the latter: it renders the sidebar at full width while
 * the rail itself is still collapsed to zero.
 */
function applySidebarWidths(expandedWidth: number, collapsed: boolean) {
  if (typeof window === 'undefined') return
  const expanded = Number.isFinite(expandedWidth) ? expandedWidth : SIDEBAR_WIDTH.DEFAULT
  const root = document.documentElement
  root.style.setProperty('--sidebar-expanded-width', `${expanded}px`)
  root.style.setProperty(
    '--sidebar-width',
    `${collapsed ? getCollapsedSidebarWidth() : expanded}px`
  )
}

/** Reads the host-specific collapsed width established by the pre-paint layout script. */
function getCollapsedSidebarWidth(): number {
  if (typeof document === 'undefined') return SIDEBAR_WIDTH.COLLAPSED
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-collapsed-width')
  )
  return Number.isFinite(value) ? value : SIDEBAR_WIDTH.COLLAPSED
}

/**
 * The `sidebar_collapsed` cookie is the single source of truth for collapse: the
 * server layout reads it to render the correct structure on the first paint
 * (it can't read `localStorage`), and the client seeds its initial state from it
 * below. Width is the only field persisted to `localStorage`.
 */
function applyCollapsedCookie(collapsed: boolean) {
  if (typeof document === 'undefined') return
  document.cookie = `sidebar_collapsed=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
}

/** Reads the collapse state the server saw, so the client store seeds identically. Matches the
 * cookie value strictly (`=1`) so `sidebar_collapsed=10` and the like aren't read as collapsed. */
export function readCollapsedCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.match(/(?:^|;\s*)sidebar_collapsed=([^;]*)/)?.[1] === '1'
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: SIDEBAR_WIDTH.DEFAULT,
      isCollapsed: readCollapsedCookie(),
      _hasHydrated: false,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        if (get().isCollapsed) return
        const clampedWidth = clampSidebarWidth(width)
        set({ sidebarWidth: clampedWidth })
        applySidebarWidths(clampedWidth, false)
      },
      toggleCollapsed: () => {
        const { isCollapsed, sidebarWidth } = get()
        const nextCollapsed = !isCollapsed
        const expandedWidth = clampSidebarWidth(sidebarWidth)
        set({ isCollapsed: nextCollapsed })
        applyCollapsedCookie(nextCollapsed)
        applySidebarWidths(expandedWidth, nextCollapsed)
      },
      syncWidth: () => {
        const { isCollapsed, sidebarWidth } = get()
        const clampedWidth = clampSidebarWidth(sidebarWidth)
        if (!isCollapsed && clampedWidth !== sidebarWidth) set({ sidebarWidth: clampedWidth })
        applySidebarWidths(clampedWidth, isCollapsed)
      },
      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
    }),
    {
      name: 'sidebar-state',
      /**
       * Width is hydrated manually from a client-only effect (see Sidebar) so
       * `_hasHydrated` is deterministically `false` during SSR and the first
       * client render — both of which read collapse from the cookie-seeded prop.
       * This is zustand's documented SSR pattern; it avoids relying on auto
       * hydration's behavior when `localStorage` is absent on the server.
       */
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true)
          applySidebarWidths(clampSidebarWidth(state.sidebarWidth), state.isCollapsed)
        }
      },
      /** Only width is persisted; collapse lives in the cookie. */
      partialize: (state) => ({ sidebarWidth: state.sidebarWidth }),
      /**
       * Never lets a legacy persisted `isCollapsed` override the cookie-seeded
       * value — the cookie is the source of truth (handles migration cleanly).
       */
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SidebarState>),
        isCollapsed: current.isCollapsed,
      }),
    }
  )
)
