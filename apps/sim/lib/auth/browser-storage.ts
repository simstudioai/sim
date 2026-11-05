import { createLogger } from '@sim/logger'

const logger = createLogger('BrowserStorage')

export const RECENT_IMPERSONATIONS_STORAGE_KEY = 'recent-impersonations'

export interface ClearBrowserUserDataOptions {
  preserveRecentImpersonations?: boolean
}

/**
 * Clears what one viewer leaves in this origin's browser storage, keeping only the keys that belong
 * to the device. Every surface on the origin shares this storage, so each one clears it at an
 * identity boundary. Returns whether all of it was cleared.
 */
export function clearBrowserUserData(options: ClearBrowserUserDataOptions = {}): boolean {
  let cleared = true

  try {
    const keysToKeep = [
      'next-favicon',
      'sim-theme',
      'sim-landing-theme',
      ...(options.preserveRecentImpersonations ? [RECENT_IMPERSONATIONS_STORAGE_KEY] : []),
    ]
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  } catch (error) {
    cleared = false
    logger.error('Error clearing local user data:', { error })
  }

  try {
    sessionStorage.clear()
  } catch (error) {
    cleared = false
    logger.error('Error clearing tab-scoped user data:', { error })
  }

  return cleared
}
