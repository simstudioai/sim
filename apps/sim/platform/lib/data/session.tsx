'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { clearBrowserUserData } from '@/lib/auth/browser-storage'
import { signOut, useSession } from '@/lib/auth/client'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
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

/**
 * Watches a session that was live settle to `null` while this app is mounted, and signs out. Keys
 * off that transition, so a signed-out visitor never arms it, and `error` is excluded so an offline
 * blip cannot read as an expiry. The same rule as the legacy surface's session-expired screen.
 */
export function useSessionExpiry() {
  const { legacyOrigin } = useOrganization()
  const { data: session, isPending, error } = useSession()
  const started = useRef(false)
  const [sawSession, setSawSession] = useState(false)
  const [wasImpersonation, setWasImpersonation] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!sawSession && session?.user) setSawSession(true)
  if (!wasImpersonation && session?.session?.impersonatedBy) setWasImpersonation(true)

  const expired = sawSession && !isPending && !error && !session?.user

  const retry = useCallback(() => {
    setFailed(false)
    void recoverSession(legacyOrigin).then((recovered) => {
      if (!recovered) setFailed(true)
    })
  }, [legacyOrigin])

  useEffect(() => {
    if (!expired || started.current) return
    started.current = true
    retry()
  }, [expired, retry])

  return { expired, failed, wasImpersonation, retry }
}

/** The active impersonation, if any, and how to return to the impersonator's own account. */
export function useImpersonation() {
  const { legacyOrigin } = useOrganization()
  const { data: session, isPending } = useSession()
  const stopImpersonating = useStopImpersonating()
  const [leaving, setLeaving] = useState(false)
  return {
    active: !isPending && Boolean(session?.session?.impersonatedBy),
    name: session?.user?.name || 'this user',
    email: session?.user?.email,
    stopping: stopImpersonating.isPending || leaving,
    stop: () =>
      stopImpersonating.mutate(undefined, {
        onSuccess: () => {
          setLeaving(true)
          clearBrowserUserData({ preserveRecentImpersonations: true })
          window.location.assign(`${legacyOrigin}${APP_ENTRY_PATH}`)
        },
      }),
  }
}
