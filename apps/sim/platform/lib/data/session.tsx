'use client'

import { type ReactNode, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { signOut, useSession } from '@/lib/auth/client'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
import { useSessionExpiry } from '@/lib/auth/session-expiry'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { useStopImpersonating } from '@/hooks/queries/admin-users'
import { useSessionQuery } from '@/hooks/queries/session'
import { clearUserData } from '@/stores'

const logger = createLogger('PlatformSession')

/** Backs `useSession` for the query hooks that read it, from the canonical session query. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error, refetch } = useSessionQuery()
  const value = useMemo<SessionHookResult>(
    () => ({
      data: data ?? null,
      isPending,
      error,
      refetch: async () => {
        await refetch()
      },
    }),
    [data, isPending, error, refetch]
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

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

function recoverSession() {
  return signOutAndLeave('/login')
}

/** The shared expiry rule, recovering through this app's sign-out. */
export function useSessionRecovery() {
  return useSessionExpiry(recoverSession)
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
