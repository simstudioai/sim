'use client'

import type React from 'react'
import { createContext, useEffect, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import {
  type AppSession,
  extractSessionDataFromAuthClientResult,
} from '@/lib/auth/session-response'
import { sessionKeys, useSessionQuery } from '@/hooks/queries/session'

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

const logger = createLogger('SessionProvider')

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const query = useSessionQuery()
  const { data, isPending, error, refetch } = query

  useEffect(() => {
    let isCancelled = false

    const params = new URLSearchParams(window.location.search)
    const wasUpgraded = params.get('upgraded') === 'true'

    if (!wasUpgraded) {
      return
    }

    params.delete('upgraded')
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname
    window.history.replaceState({}, '', newUrl)

    const refreshAfterUpgrade = async () => {
      const res = await client.getSession({ query: { disableCookieCache: true } })
      const fresh = extractSessionDataFromAuthClientResult(res) as AppSession

      if (isCancelled) return null

      await queryClient.cancelQueries({ queryKey: sessionKeys.detail() })
      queryClient.setQueryData(sessionKeys.detail(), fresh)
      return fresh
    }

    const initializeSession = async () => {
      let session: AppSession = null
      try {
        session = await refreshAfterUpgrade()
      } catch (e) {
        logger.warn('Failed to refresh session after subscription upgrade', { error: e })
      }

      if (isCancelled) {
        return
      }

      // Refresh the plan surfaces even if the cookie-bypass read above failed: they
      // query server truth (not the session cookie cache), so they still reconcile.
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['subscription'] })

      const activeOrganizationId = session?.session?.activeOrganizationId ?? null
      if (!session || activeOrganizationId) {
        return
      }

      try {
        const organizationsResponse = await client.organization.list()
        const organizations = organizationsResponse.data ?? []
        const organizationId = organizations.length === 1 ? organizations[0]?.id : null

        if (!organizationId || isCancelled) {
          return
        }

        await client.organization.setActive({ organizationId })

        if (!isCancelled) {
          const res = await client.getSession({ query: { disableCookieCache: true } })
          const fresh = extractSessionDataFromAuthClientResult(res) as AppSession
          if (!isCancelled) {
            await queryClient.cancelQueries({ queryKey: sessionKeys.detail() })
            queryClient.setQueryData(sessionKeys.detail(), fresh)
          }
        }
      } catch (error) {
        logger.warn('Failed to activate organization after subscription upgrade', { error })
      }
    }

    void initializeSession()

    return () => {
      isCancelled = true
    }
  }, [queryClient])

  useEffect(() => {
    if (isPending) return

    import('posthog-js')
      .then(({ default: posthog }) => {
        try {
          if (typeof posthog.identify !== 'function') return

          if (data?.user) {
            posthog.identify(data.user.id, {
              email: data.user.email,
              name: data.user.name,
              email_verified: data.user.emailVerified,
              created_at: data.user.createdAt,
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
  }, [data, isPending])

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
