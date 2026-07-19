'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { recoverFromStaleSession } from '@/lib/auth/stale-session-recovery'

/**
 * Cleanly logs out when an impersonation session expires while the app is
 * mounted.
 *
 * Detection keys off the transition: this only activates when the session
 * query settles to `null` after a session that carried `impersonatedBy` (the
 * expired session is deleted server-side, so the live session can't be used).
 *
 * Recovery goes through {@link recoverFromStaleSession}: the expired session's
 * cookies are never cleared server-side (better-auth's customSession plugin
 * swallows the deletion headers), and the login route bounces any request
 * still carrying a session cookie back to /workspace. The helper signs out
 * (which clears the cookies without requiring a live session), wipes per-user
 * client state, and only navigates when the sign-out succeeded — navigating
 * after a failed sign-out would recreate the redirect loop.
 */
export function ImpersonationExpired() {
  const { data: session, isPending, error } = useSession()
  const startedRef = useRef(false)
  const [sawImpersonation, setSawImpersonation] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!sawImpersonation && session?.session?.impersonatedBy) {
    setSawImpersonation(true)
  }

  const expired = sawImpersonation && !isPending && !error && !session?.user

  const attemptRecovery = useCallback(() => {
    setFailed(false)
    void recoverFromStaleSession().then((recovered) => {
      if (!recovered) setFailed(true)
    })
  }, [])

  useEffect(() => {
    if (!expired || startedRef.current) return
    startedRef.current = true
    attemptRecovery()
  }, [expired, attemptRecovery])

  if (!expired) {
    return null
  }

  return (
    <main className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[var(--surface-1)] p-6'>
      <p className='text-[var(--text-muted)] text-sm'>
        {failed
          ? 'The impersonation session expired, but signing out failed.'
          : 'The impersonation session expired. Signing you out…'}
      </p>
      {failed && (
        <Chip variant='primary' onClick={attemptRecovery}>
          Try again
        </Chip>
      )}
    </main>
  )
}
