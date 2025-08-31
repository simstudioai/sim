'use client'

import type React from 'react'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { client } from '@/lib/auth-client'

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

  const loadSession = useCallback(async () => {
    try {
      setIsPending(true)
      setError(null)
      const res = await client.getSession()
      setData(res?.data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch session'))
    } finally {
      setIsPending(false)
    }
  }, [])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  const value = useMemo<SessionHookResult>(
    () => ({ data, isPending, error, refetch: loadSession }),
    [data, isPending, error, loadSession]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
