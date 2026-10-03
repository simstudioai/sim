'use client'

import { useEffect } from 'react'
import { observeDesktopTitleBar } from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'

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
    return observeDesktopTitleBar(document.documentElement, navigator.userAgent, bridge)
  }, [])

  return null
}
