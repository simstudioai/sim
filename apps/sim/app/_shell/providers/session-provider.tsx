'use client'

import type React from 'react'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import { extractSessionDataFromAuthClientResult } from '@/lib/auth/session-response'

export type AppSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    role?: string
    createdAt?: Date
    updatedAt?: Date
  } | null
  session?: {
    id?: string
    userId?: string
    activeOrganizationId?: string
    impersonatedBy?: string | null
  }
} | null

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

const logger = createLogger('SessionProvider')

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppSession>(null)
  const [isPending, setIsPending] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const queryClient = useQueryClient()

  const loadSession = useCallback(async (bypassCache = false) => {
    try {
      setIsPending(true)
      setError(null)
      const res = bypassCache
        ? await client.getSession({ query: { disableCookieCache: true } })
        : await client.getSession()
      const session = extractSessionDataFromAuthClientResult(res) as AppSession
      setData(session)
      return session
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch session'))
      return null
    } finally {
      setIsPending(false)
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    // Check if user was redirected after plan upgrade
    const params = new URLSearchParams(window.location.search)
    const wasUpgraded = params.get('upgraded') === 'true'

    if (wasUpgraded) {
      params.delete('upgraded')
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname
      window.history.replaceState({}, '', newUrl)
    }

    const initializeSession = async () => {
      const session = await loadSession(wasUpgraded)

      if (!wasUpgraded || isCancelled) {
        return
      }

      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['subscription'] })

      const activeOrganizationId = session?.session?.activeOrganizationId ?? null
      if (activeOrganizationId) {
        return
      }

      try {
        const response = await fetch('/api/organizations')
        if (!response.ok) {
          return
        }

        const orgData = (await response.json()) as {
          organizations?: Array<{ id: string }>
        }
        const organizationId = orgData.organizations?.[0]?.id

        if (!organizationId || isCancelled) {
          return
        }

        await client.organization.setActive({ organizationId })

        if (!isCancelled) {
          await loadSession(true)
        }
      } catch (error) {
        logger.warn('Failed to activate organization after subscription upgrade', { error })
      }
    }

    void initializeSession()

    return () => {
      isCancelled = true
    }
  }, [loadSession, queryClient])

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

  const refetch = useCallback(async () => {
    await loadSession()
  }, [loadSession])

  const value = useMemo<SessionHookResult>(
    () => ({ data, isPending, error, refetch }),
    [data, isPending, error, refetch]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
