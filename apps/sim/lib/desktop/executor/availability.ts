import { isDesktopPresenceAvailable } from '@/lib/desktop/executor/presence'
import { hasSignedInDesktopExecutor } from '@/lib/desktop/executor/repository'

/**
 * Whether new turns may bind to a desktop, and whether the workspace shows background desktop
 * activity. The executor needs presence tracking, so an install without Redis keeps desktop tools
 * in the chat window. Never consulted for a run already bound: it keeps running on its desktop.
 */
export function isDesktopBackgroundExecutorAvailable(): boolean {
  return isDesktopPresenceAvailable()
}

/**
 * Whether the user's turns can run on one of their desktops, so their workspace has background
 * desktop activity to show. Most users never install the app, and their pages never ask.
 */
export async function hasDesktopBackgroundExecutor(userId: string): Promise<boolean> {
  if (!isDesktopBackgroundExecutorAvailable()) return false
  return hasSignedInDesktopExecutor(userId)
}
