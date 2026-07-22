'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'

export type DesktopTitleBarMode = 'fullscreen' | 'inset' | null

/** The frameless Quick Ask panel has no native traffic lights to reserve. */
export function supportsDesktopTitleBar(
  pathname: string,
  userAgent: string,
  hasDesktopBridge: boolean
): boolean {
  return hasDesktopBridge && /Mac/i.test(userAgent) && pathname !== '/desktop/launcher'
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
 * Keeps the macOS title-bar inset correct across every App Router surface and
 * native fullscreen transition. The blocking head script owns first paint;
 * this controller owns client navigation and subsequent window-state changes.
 */
export function DesktopTitleBarController() {
  const pathname = usePathname()

  useEffect(() => {
    const bridge = getDesktopBridge()
    const root = document.documentElement
    if (!supportsDesktopTitleBar(pathname, navigator.userAgent, Boolean(bridge))) {
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
  }, [pathname])

  return null
}
