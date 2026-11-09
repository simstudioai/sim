'use client'

import { type ReactNode, useDeferredValue, useEffect, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/client'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
import {
  type AppSession,
  extractSessionDataFromAuthClientResult,
  getActiveOrganizationId,
} from '@/lib/auth/session-response'
import { useSessionQuery } from '@/hooks/queries/session'
import { sessionKeys } from '@/hooks/queries/utils/session-keys'

const logger = createLogger('SessionProvider')

/**
 * Checkout returns with `?upgraded=true` (`lib/billing/client/upgrade.ts`). Strips the flag, then
 * re-reads the session past Better Auth's cookie cache, refreshes the plan surfaces, and activates
 * the viewer's organization when they belong to exactly one and none is active.
 */
function useUpgradeReturnReconcile() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let isCancelled = false

    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded') !== 'true') return

    params.delete('upgraded')
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname
    window.history.replaceState({}, '', newUrl)

    const readFreshSession = async () => {
      const res = await client.getSession({ query: { disableCookieCache: true } })
      const fresh = extractSessionDataFromAuthClientResult(res) as AppSession
      if (isCancelled) return null
      await queryClient.cancelQueries({ queryKey: sessionKeys.detail() })
      queryClient.setQueryData(sessionKeys.detail(), fresh)
      return fresh
    }

    const reconcile = async () => {
      let session: AppSession = null
      try {
        session = await readFreshSession()
      } catch (e) {
        logger.warn('Failed to refresh session after subscription upgrade', { error: e })
      }

      if (isCancelled) return

      // Refresh the plan surfaces even if the cookie-bypass read above failed: they
      // query server truth (not the session cookie cache), so they still reconcile.
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['subscription'] })

      if (!session || getActiveOrganizationId(session)) return

      try {
        const organizationsResponse = await client.organization.list()
        const organizations = organizationsResponse.data ?? []
        const organizationId = organizations.length === 1 ? organizations[0]?.id : null
        if (!organizationId || isCancelled) return

        await client.organization.setActive({ organizationId })
        if (!isCancelled) await readFreshSession()
      } catch (error) {
        logger.warn('Failed to activate organization after subscription upgrade', { error })
      }
    }

    void reconcile()

    return () => {
      isCancelled = true
    }
  }, [queryClient])
}

/** Identifies the signed-in viewer to PostHog and starts session recording; resets on sign-out. */
function useAnalyticsIdentity(session: AppSession | undefined, isPending: boolean) {
  useEffect(() => {
    if (isPending) return

    import('posthog-js')
      .then(({ default: posthog }) => {
        try {
          if (typeof posthog.identify !== 'function') return

          if (session?.user) {
            posthog.identify(session.user.id, {
              email: session.user.email,
              name: session.user.name,
              email_verified: session.user.emailVerified,
              created_at: session.user.createdAt,
            })
            if (
              typeof posthog.startSessionRecording === 'function' &&
              typeof posthog.sessionRecordingStarted === 'function' &&
              !posthog.sessionRecordingStarted()
            ) {
              posthog.startSessionRecording()
            }
          } else {
            posthog.reset()
          }
        } catch {}
      })
      .catch(() => {})
  }, [session, isPending])
}

/**
 * Backs `useSession` from the canonical session query, which the Platform shell seeds on the
 * server. Every root mounts this one provider, so the upgrade return and analytics identity hold
 * on site, legacy and Platform pages alike.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error, refetch } = useSessionQuery()
  useUpgradeReturnReconcile()
  useAnalyticsIdentity(data, isPending)

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

  // The read settles above every route's Suspense boundary. An urgent context change makes React
  // discard the server HTML of a boundary whose hydration is waiting on its chunk, so each row is
  // rebuilt and asks for its images again; deferred, the change waits for hydration to finish.
  const settledValue = useDeferredValue(value)

  return <SessionContext.Provider value={settledValue}>{children}</SessionContext.Provider>
}
