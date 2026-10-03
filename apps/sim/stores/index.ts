'use client'

import { createLogger } from '@sim/logger'

const logger = createLogger('Stores')

export const RECENT_IMPERSONATIONS_STORAGE_KEY = 'recent-impersonations'

interface ClearUserDataOptions {
  preserveRecentImpersonations?: boolean
}

/**
 * Clears browser and in-memory data at an authenticated identity boundary.
 * Returns whether the in-memory reset completed, so SPA callers can fall back
 * to a full document navigation when the reset chunk is unavailable.
 */
export async function clearUserData(options: ClearUserDataOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return true

  let cleanupFailed = false
  let inMemoryResetSucceeded = true

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
    inMemoryResetSucceeded = false
    logger.error('Error resetting in-memory user data:', { error })
  }

  if (!cleanupFailed) logger.info('User data cleared successfully')
  return inMemoryResetSucceeded
}
