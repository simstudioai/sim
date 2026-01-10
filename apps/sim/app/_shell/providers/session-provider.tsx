'use client'

import type React from 'react'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import posthog from 'posthog-js'
import { client } from '@/lib/auth/auth-client'

export type AppSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    createdAt?: Date
    updatedAt?: Date
  } | null
  session?: {
    id?: string
    userId?: string
    activeOrganizationId?: string
  }
} | null

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

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
      setData(res?.data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch session'))
    } finally {
      setIsPending(false)
    }
  }, [])

  useEffect(() => {
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

    loadSession(wasUpgraded).then(() => {
      if (wasUpgraded) {
        queryClient.invalidateQueries({ queryKey: ['organizations'] })
        queryClient.invalidateQueries({ queryKey: ['subscription'] })
      }
    })
  }, [loadSession, queryClient])

  useEffect(() => {
    if (isPending || typeof posthog.identify !== 'function') {
      return
    }

    try {
      if (data?.user) {
        posthog.identify(data.user.id, {
          email: data.user.email,
          name: data.user.name,
          email_verified: data.user.emailVerified,
          created_at: data.user.createdAt,
        })
      } else {
        posthog.reset()
      }
    } catch {}
  }, [data, isPending])

  const value = useMemo<SessionHookResult>(
    () => ({ data, isPending, error, refetch: loadSession }),
    [data, isPending, error, loadSession]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
