'use client'

import { createLogger } from '@sim/logger'

const logger = createLogger('Stores')

/** localStorage key for the admin recent-impersonations list; kept through clearUserData. */
export const RECENT_IMPERSONATIONS_STORAGE_KEY = 'recent-impersonations'

/**
 * Clear all user data when signing out.
 */
export async function clearUserData(): Promise<void> {
  if (typeof window === 'undefined') return

  let cleanupFailed = false

  try {
    const keysToKeep = ['next-favicon', 'theme', RECENT_IMPERSONATIONS_STORAGE_KEY]
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  } catch (error) {
    cleanupFailed = true
    logger.error('Error clearing persisted user data:', { error })
  }

  try {
    const { resetAllStores } = await import('@/stores/reset-all-stores')
    resetAllStores()
  } catch (error) {
    cleanupFailed = true
    logger.error('Error resetting in-memory user data:', { error })
  }

  if (!cleanupFailed) logger.info('User data cleared successfully')
}
