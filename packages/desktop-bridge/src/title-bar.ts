import type { DesktopPlatform, SimDesktopWindowStateApi } from '@sim/desktop-bridge'

export type DesktopTitleBarMode = 'fullscreen' | 'inset' | null
export const DESKTOP_TITLE_BAR_ATTRIBUTE = 'data-sim-desktop-title-bar'

interface TitleBarBridge {
  platform?: DesktopPlatform
  windowState?: SimDesktopWindowStateApi
}

/** Only macOS draws traffic lights over the page; Windows keeps its native frame. */
function supportsDesktopTitleBar(bridge: TitleBarBridge | undefined): boolean {
  return bridge !== undefined && (bridge.platform ?? 'darwin') === 'darwin'
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
  bridge?: TitleBarBridge
): (() => void) | undefined {
  if (!supportsDesktopTitleBar(bridge)) {
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
