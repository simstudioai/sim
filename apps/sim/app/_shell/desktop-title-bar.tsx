'use client'

import { useEffect } from 'react'
import { getDesktopBridge } from '@/lib/desktop'

export type DesktopTitleBarMode = 'fullscreen' | 'inset' | null

/** The document marker every lane owner reads and writes. */
export const DESKTOP_TITLE_BAR_ATTRIBUTE = 'data-sim-desktop-title-bar'

/**
 * Whether this surface reserves the macOS traffic-light lane itself.
 *
 * There is no route check: the caller mounting {@link DesktopTitleBarController} IS the
 * signal. Only `AuthShell` mounts it, and every surface wearing that shell — the `(auth)`
 * routes, the CLI auth handoff, the invite pages — sits outside workspace chrome and must
 * clear the lights. Workspace routes never render it; `WorkspaceChrome` owns the lane
 * there through its own listener, and two owners would fight over the attribute.
 *
 * A route list was the previous shape and could not survive `/invite/[id]`.
 */
export function supportsDesktopTitleBar(userAgent: string, hasDesktopBridge: boolean): boolean {
  return hasDesktopBridge && /Mac/i.test(userAgent)
}

export function applyDesktopTitleBarMode(
  root: Pick<HTMLElement, 'removeAttribute' | 'setAttribute'>,
  mode: DesktopTitleBarMode
): void {
  if (mode === null) {
    root.removeAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)
    return
  }
  root.setAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE, mode)
}

/**
 * Reserves the macOS traffic-light lane for a full-viewport surface outside workspace
 * chrome. Pair it with `desktop-title-bar-page` on the surface's own root.
 *
 * The two halves ship together on purpose. Reserving the space without this leaves the
 * lane visually clear but undraggable — the window loses its title bar on that page —
 * and that is exactly what happened when `/oauth-error` and the public-file view were
 * given the class alone. The surface audit enforces the pairing.
 */
export function DesktopTitleBarLane() {
  return (
    <>
      <DesktopTitleBarController />
      <div aria-hidden className='desktop-login-window-drag-region desktop-window-drag-region' />
    </>
  )
}

/**
 * Keeps the inset correct across native fullscreen transitions, where the traffic lights
 * disappear and the lane must collapse. Rendered by `AuthShell`; workspace routes retain
 * their existing WorkspaceChrome-owned listener.
 */
export function DesktopTitleBarController() {
  useEffect(() => {
    const bridge = getDesktopBridge()
    const root = document.documentElement
    if (!supportsDesktopTitleBar(navigator.userAgent, Boolean(bridge))) {
      applyDesktopTitleBarMode(root, null)
      return
    }

    const windowState = bridge?.windowState
    /**
     * Seed `inset` only when nobody has established a mode yet.
     *
     * The pre-paint script sets this before first paint and `WorkspaceChrome` maintains it
     * for workspace routes, so writing unconditionally clobbered whatever they had:
     * mounting a lane-aware overlay during native fullscreen forced the traffic-light lane
     * back on and jumped the content, and left it wrong entirely if `getState()` rejected.
     */
    if (!root.hasAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)) {
      applyDesktopTitleBarMode(root, 'inset')
    }
    if (!windowState) return

    let disposed = false
    const applyWindowState = ({ isFullScreen }: { isFullScreen: boolean }) => {
      if (!disposed) {
        applyDesktopTitleBarMode(root, isFullScreen ? 'fullscreen' : 'inset')
      }
    }
    const unsubscribe = windowState.onStateChange(applyWindowState)
    void windowState
      .getState()
      .then(applyWindowState)
      .catch(() => {})

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return null
}
