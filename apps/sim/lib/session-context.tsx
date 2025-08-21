'use client'

import type React from 'react'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { client } from '@/lib/auth-client'

type SessionUser = {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  [key: string]: unknown
}

type SessionData = {
  user?: SessionUser
  [key: string]: unknown
} | null

type SessionHookResult = {
  data: SessionData
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SessionData>(null)
  const [isPending, setIsPending] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchSession = useCallback(async () => {
    try {
      setIsPending(true)
      setError(null)
      const res = await client.getSession()
      setData((res as any)?.data ?? null)
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Failed to fetch session')
      setError(err)
    } finally {
      setIsPending(false)
    }
  }, [])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  const value = useMemo<SessionHookResult>(
    () => ({
      data,
      isPending,
      error,
      refetch: fetchSession,
    }),
    [data, isPending, error, fetchSession]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
