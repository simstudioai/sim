import { isDesktopPresenceAvailable } from '@/lib/desktop/executor/presence'

/**
 * Whether new turns may bind to a desktop, and whether the workspace shows background desktop
 * activity. The executor needs presence tracking, so an install without Redis keeps desktop tools
 * in the chat window. Never consulted for a run already bound: it keeps running on its desktop.
 */
export function isDesktopBackgroundExecutorAvailable(): boolean {
  return isDesktopPresenceAvailable()
}
