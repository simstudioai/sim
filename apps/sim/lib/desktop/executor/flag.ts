import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isDesktopPresenceAvailable } from '@/lib/desktop/executor/presence'

/**
 * Whether this user's new turns may bind to a desktop, and whether the UI shows background desktop
 * activity. Never consulted for a run already bound: it keeps running on its desktop until it ends.
 */
export async function isDesktopBackgroundExecutorEnabled(userId: string): Promise<boolean> {
  if (!isDesktopPresenceAvailable()) return false
  return isFeatureEnabled('mothership-desktop-background-executor', { userId })
}
