'use client'

import { useEffect, useRef, useState } from 'react'
import { signOut, useSession } from '@/lib/auth/auth-client'

/**
 * Cleanly logs out when an impersonation session expires while the app is
 * mounted.
 *
 * Detection keys off the transition: this only activates when the session
 * query settles to `null` after a session that carried `impersonatedBy` (the
 * expired session is deleted server-side, so the live session can't be used).
 *
 * The explicit sign-out before redirecting matters: the expired session's
 * cookies are never cleared server-side (better-auth's customSession plugin
 * swallows the deletion headers on the null path), and the login route
 * bounces any request still carrying a session cookie back to /workspace —
 * an infinite loop on a blank page. /sign-out clears the cookies without
 * requiring a live session.
 */
export function ImpersonationExpired() {
  const { data: session, isPending, error } = useSession()
  const startedRef = useRef(false)
  const [sawImpersonation, setSawImpersonation] = useState(false)

  if (!sawImpersonation && session?.session?.impersonatedBy) {
    setSawImpersonation(true)
  }

  const expired = sawImpersonation && !isPending && !error && !session?.user

  useEffect(() => {
    if (!expired || startedRef.current) return
    startedRef.current = true
    signOut()
      .catch(() => {})
      .finally(() => window.location.assign('/login'))
  }, [expired])

  if (!expired) {
    return null
  }

  return (
    <main className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-1)] p-6'>
      <p className='text-[var(--text-muted)] text-sm'>
        The impersonation session expired. Signing you out…
      </p>
    </main>
  )
}
