'use client'

import { type ReactNode, useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { clearBrowserUserData } from '@/lib/auth/browser-storage'
import { signOut, useSession } from '@/lib/auth/client'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
import { useSessionExpiry } from '@/lib/auth/session-expiry'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { useStopImpersonating } from '@/hooks/queries/admin-users'
import { useSessionQuery } from '@/hooks/queries/session'
import { useOrganization } from '@/platform/lib/data/organization'

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
 * Signs out, clears this viewer's browser storage, then leaves for login. Returns false without
 * navigating when sign-out fails: the cookies survive, so login would bounce straight back. Leaving
 * the document is what resets this app's in-memory state, which the legacy reset cannot reach.
 */
async function recoverSession(legacyOrigin: string): Promise<boolean> {
  try {
    await signOut()
  } catch (error) {
    logger.error('Failed to sign out while recovering from a stale session', { error })
    return false
  }
  clearBrowserUserData()
  window.location.assign(`${legacyOrigin}/login`)
  return true
}

/** The shared expiry rule, recovering through this app's sign-out. */
export function useSessionRecovery() {
  const { legacyOrigin } = useOrganization()
  const recover = useCallback(() => recoverSession(legacyOrigin), [legacyOrigin])
  return useSessionExpiry(recover)
}

export function useImpersonation() {
  const { legacyOrigin } = useOrganization()
  const { data: session, isPending } = useSession()
  const stopImpersonating = useStopImpersonating()
  return {
    active: !isPending && Boolean(session?.session?.impersonatedBy),
    name: session?.user?.name || 'this user',
    email: session?.user?.email,
    stopping: stopImpersonating.isPending || stopImpersonating.isSuccess,
    stop: () =>
      stopImpersonating.mutate(undefined, {
        onSuccess: () => {
          clearBrowserUserData({ preserveRecentImpersonations: true })
          window.location.assign(`${legacyOrigin}${APP_ENTRY_PATH}`)
        },
      }),
  }
}
