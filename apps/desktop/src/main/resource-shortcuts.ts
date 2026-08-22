import type { DesktopZoomAction } from '@sim/desktop-bridge'

/**
 * Commands claimed by whichever embedded resource currently owns keyboard
 * focus. The application menu sees these before an embedded page or xterm
 * does, so Browser and Terminal must resolve them at this shared boundary.
 */
export type FocusedResourceShortcut =
  | 'new-tab'
  | 'reopen-closed-tab'
  | 'close-tab'
  | 'focus-omnibox'
  | ResourceTabSelectionShortcut
  | 'reload-or-clear'
  | 'hard-reload'
  | `zoom-${DesktopZoomAction}`

export type ResourceTabSelectionShortcut =
  | 'next-tab'
  | 'previous-tab'
  | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export function isResourceTabSelectionShortcut(
  shortcut: FocusedResourceShortcut
): shortcut is ResourceTabSelectionShortcut {
  return (
    shortcut === 'next-tab' || shortcut === 'previous-tab' || shortcut.startsWith('select-tab-')
  )
}

/** Resolves browser-style next/previous and numbered tab shortcuts. */
export function resourceTabTargetIndex(
  shortcut: ResourceTabSelectionShortcut,
  tabCount: number,
  activeIndex: number
): number | null {
  if (tabCount <= 0) return null
  if (shortcut === 'next-tab') return activeIndex < 0 ? 0 : (activeIndex + 1) % tabCount
  if (shortcut === 'previous-tab') {
    return activeIndex < 0 ? tabCount - 1 : (activeIndex - 1 + tabCount) % tabCount
  }
  const requested = Number(shortcut.slice('select-tab-'.length))
  const target = requested === 9 ? tabCount - 1 : requested - 1
  return target >= 0 && target < tabCount ? target : null
}

export function zoomActionForShortcut(shortcut: `zoom-${DesktopZoomAction}`): DesktopZoomAction {
  switch (shortcut) {
    case 'zoom-in':
      return 'in'
    case 'zoom-out':
      return 'out'
    case 'zoom-reset':
      return 'reset'
  }
}
