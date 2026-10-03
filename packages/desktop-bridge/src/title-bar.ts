import type { SimDesktopWindowStateApi } from '@sim/desktop-bridge'

export type DesktopTitleBarMode = 'fullscreen' | 'inset' | null
export const DESKTOP_TITLE_BAR_ATTRIBUTE = 'data-sim-desktop-title-bar'

export function supportsDesktopTitleBar(userAgent: string, hasDesktopBridge: boolean): boolean {
  return hasDesktopBridge && /Mac/i.test(userAgent)
}

export function applyDesktopTitleBarMode(
  root: Pick<HTMLElement, 'removeAttribute' | 'setAttribute'>,
  mode: DesktopTitleBarMode
): void {
  if (mode === null) root.removeAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)
  else root.setAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE, mode)
}

/** Shares native title-bar geometry and fullscreen transitions across hosted and offline pages. */
export function observeDesktopTitleBar(
  root: HTMLElement,
  userAgent: string,
  bridge?: { windowState?: SimDesktopWindowStateApi }
): (() => void) | undefined {
  if (!supportsDesktopTitleBar(userAgent, Boolean(bridge))) {
    applyDesktopTitleBarMode(root, null)
    return
  }
  /** Preserve a mode already established before paint or by workspace chrome. */
  if (!root.hasAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)) applyDesktopTitleBarMode(root, 'inset')
  const windowState = bridge?.windowState
  if (!windowState) return
  let disposed = false
  let receivedUpdate = false
  const apply = ({ isFullScreen }: { isFullScreen: boolean }) => {
    if (!disposed) applyDesktopTitleBarMode(root, isFullScreen ? 'fullscreen' : 'inset')
  }
  const unsubscribe = windowState.onStateChange((state) => {
    receivedUpdate = true
    apply(state)
  })
  void windowState
    .getState()
    .then((state) => {
      if (!receivedUpdate) apply(state)
    })
    .catch(() => {})
  return () => {
    disposed = true
    unsubscribe()
  }
}
