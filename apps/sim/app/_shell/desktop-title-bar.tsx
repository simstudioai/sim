'use client'

import { useEffect } from 'react'
import { getDesktopBridge } from '@/lib/desktop'

export type DesktopTitleBarMode = 'fullscreen' | 'inset' | null

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
    root.removeAttribute('data-sim-desktop-title-bar')
    return
  }
  root.setAttribute('data-sim-desktop-title-bar', mode)
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
    applyDesktopTitleBarMode(root, 'inset')
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
