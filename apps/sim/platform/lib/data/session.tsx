'use client'

import { createLogger } from '@sim/logger'
import { signOut, useSession } from '@/lib/auth/client'
import { useSessionExpiry } from '@/lib/auth/session-expiry'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { useStopImpersonating } from '@/hooks/queries/admin-users'
import { clearUserData } from '@/stores'

const logger = createLogger('PlatformSession')

/**
 * Signs out while clearing what this viewer holds in the tab (`clearUserData`: running desktop
 * tools stop at once, then stores, the query cache and browser storage), then leaves for login.
 * The clear runs alongside the request, not after it, so a desktop tool never outlives a sign-out
 * that hangs. Returns false without navigating when sign-out fails: the cookies survive, so login
 * would bounce straight back.
 */
export async function signOutAndLeave(loginUrl: string): Promise<boolean> {
  const [signedOut] = await Promise.allSettled([signOut(), clearUserData()])
  if (signedOut.status === 'rejected') {
    logger.error('Failed to sign out', { error: signedOut.reason })
    return false
  }
  window.location.assign(loginUrl)
  return true
}

/**
 * Opens `href` after the viewer's organizations changed (an accepted invitation, a left
 * organization) with a document load: the product root reads the organization once per document,
 * so a client navigation would keep the previous organization's providers, navigation and flags.
 */
export function openAcrossOrganizations(href: string) {
  window.location.assign(href)
}

function recoverSession() {
  return signOutAndLeave('/login')
}

/** Another tab signed in as someone else: drop this viewer's data and reload as the new user. */
async function leaveForNewUser() {
  try {
    await clearUserData()
  } finally {
    window.location.assign(APP_ENTRY_PATH)
  }
}

/** The shared expiry rule, recovering through this app's sign-out. */
export function useSessionRecovery() {
  return useSessionExpiry(recoverSession, leaveForNewUser)
}

export function useImpersonation() {
  const { data: session, isPending } = useSession()
  const stopImpersonating = useStopImpersonating()
  return {
    active: !isPending && Boolean(session?.session?.impersonatedBy),
    name: session?.user?.name || 'this user',
    email: session?.user?.email,
    stopping: stopImpersonating.isPending || stopImpersonating.isSuccess,
    stop: () =>
      stopImpersonating.mutate(undefined, {
        onSuccess: async () => {
          await clearUserData({ preserveRecentImpersonations: true })
          window.location.assign(APP_ENTRY_PATH)
        },
      }),
  }
}
