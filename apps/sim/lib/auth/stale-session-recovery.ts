'use client'

import { createLogger } from '@sim/logger'
import { signOut } from '@/lib/auth/auth-client'
import { clearUserData } from '@/stores'

const logger = createLogger('StaleSessionRecovery')

/**
 * Signs out (clearing every auth cookie server-side), wipes per-user client
 * state, and navigates to login. Returns false without navigating when the
 * sign-out request fails — the cookies are still set, so going to /login
 * would only get bounced back to /workspace by the middleware.
 *
 * Shared by the /workspace loader (stale-cookie 401s and clean-null sessions)
 * and the impersonation-expired screen, so every identity-recovery path clears
 * cookies and persisted client state the same way.
 */
export async function recoverFromStaleSession(): Promise<boolean> {
  try {
    await signOut()
  } catch (error) {
    logger.error('Failed to sign out while recovering from a stale session:', error)
    return false
  }
  await clearUserData()
  window.location.assign('/login')
  return true
}
