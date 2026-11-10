'use client'

import { createLogger } from '@sim/logger'
import { type ClearBrowserUserDataOptions, clearBrowserUserData } from '@/lib/auth/browser-storage'
import { stopAllDesktopTools } from '@/hooks/mothership-chat/desktop-tool-lifetimes'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const logger = createLogger('Stores')

/** Why desktop tools still running for the previous identity were cancelled. */
const SIGNED_OUT_ABORT_REASON = 'identity_boundary:clearUserData'

/**
 * Clears browser and in-memory data at an authenticated identity boundary.
 * Returns whether the in-memory reset completed, so SPA callers can fall back
 * to a full document navigation when the reset chunk is unavailable.
 */
export async function clearUserData(options: ClearBrowserUserDataOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return true

  stopAllDesktopTools(SIGNED_OUT_ABORT_REASON)

  const cleanupFailed = !clearBrowserUserData(options)
  let inMemoryResetFailed = false

  try {
    const { resetAllStores } = await import('@/stores/reset-all-stores')
    await resetAllStores()
  } catch (error) {
    inMemoryResetFailed = true
    logger.error('Error resetting in-memory user data:', { error })
  }

  if (!cleanupFailed && !inMemoryResetFailed) logger.info('User data cleared successfully')
  useSettingsDirtyStore.getState().reset()
  return !inMemoryResetFailed
}
