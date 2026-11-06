'use client'

import { createContext } from 'react'
import type { AppSession } from '@/lib/auth/session-response'

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/** What `useSession` reads. Separate from any provider, so the auth client imports no surface. */
export const SessionContext = createContext<SessionHookResult | null>(null)
