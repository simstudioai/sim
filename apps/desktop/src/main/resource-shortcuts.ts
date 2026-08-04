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
  | 'reload-or-clear'
  | `zoom-${DesktopZoomAction}`

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
