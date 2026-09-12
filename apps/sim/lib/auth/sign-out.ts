import { createLogger } from '@sim/logger'
import { signOut } from '@/lib/auth/auth-client'
import { clearUserData } from '@/stores'

const logger = createLogger('SignOut')

/** Reloads the page if any in-memory user state could not be cleared. */
export async function signOutAndRedirect(navigate: (href: string) => void): Promise<void> {
  const logoutUrl = '/login?fromLogout=true'
  let canNavigateInApp = false

  try {
    const [, inMemoryResetSucceeded] = await Promise.all([signOut(), clearUserData()])
    canNavigateInApp = inMemoryResetSucceeded
  } catch (error) {
    logger.error('Error signing out:', { error })
  }

  if (canNavigateInApp) navigate(logoutUrl)
  else window.location.assign(logoutUrl)
}
