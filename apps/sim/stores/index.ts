'use client'

import { createLogger } from '@sim/logger'

const logger = createLogger('Stores')

/** localStorage key for the admin recent-impersonations list. */
export const RECENT_IMPERSONATIONS_STORAGE_KEY = 'recent-impersonations'

interface ClearUserDataOptions {
  preserveRecentImpersonations?: boolean
}

/** Clears browser and in-memory data at an authenticated identity boundary. */
export async function clearUserData(options: ClearUserDataOptions = {}): Promise<void> {
  if (typeof window === 'undefined') return

  let cleanupFailed = false

  try {
    const keysToKeep = [
      'next-favicon',
      'sim-theme',
      ...(options.preserveRecentImpersonations ? [RECENT_IMPERSONATIONS_STORAGE_KEY] : []),
    ]
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  } catch (error) {
    cleanupFailed = true
    logger.error('Error clearing local user data:', { error })
  }

  try {
    sessionStorage.clear()
  } catch (error) {
    cleanupFailed = true
    logger.error('Error clearing tab-scoped user data:', { error })
  }

  try {
    const { resetAllStores } = await import('@/stores/reset-all-stores')
    await resetAllStores()
  } catch (error) {
    cleanupFailed = true
    logger.error('Error resetting in-memory user data:', { error })
  }

  if (!cleanupFailed) logger.info('User data cleared successfully')
}
