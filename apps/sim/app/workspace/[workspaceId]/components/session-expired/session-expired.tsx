'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { recoverFromStaleSession } from '@/lib/auth/stale-session-recovery'

/**
 * Cleanly logs out when the session dies while the app is mounted.
 *
 * The workspace shell's auth gate is a Server Component, so it only re-evaluates
 * on a server render — a session that expires or is revoked mid-visit leaves the
 * SPA mounted and silently failing every request, with nothing to redirect it.
 * This watches the canonical session query for that transition instead.
 *
 * Detection keys off the transition, never off a single failed request: it
 * activates only once a session that was live settles to `null`. A signed-out
 * visitor never arms it (there was no session to lose), and `error` is excluded
 * so an offline blip or a 5xx can never masquerade as an expiry.
 *
 * Recovery goes through {@link recoverFromStaleSession}: an expired session's
 * cookies are never cleared server-side (better-auth's customSession plugin
 * swallows the deletion headers), and a request still carrying a session cookie
 * gets bounced off /login. The helper signs out (which clears the cookies
 * without requiring a live session), wipes per-user client state, and only
 * navigates when the sign-out succeeded — navigating after a failed sign-out
 * would recreate the redirect loop.
 */
export function SessionExpired() {
  const { data: session, isPending, error } = useSession()
  const startedRef = useRef(false)
  const [sawSession, setSawSession] = useState(false)
  const [wasImpersonation, setWasImpersonation] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!sawSession && session?.user) {
    setSawSession(true)
  }
  if (!wasImpersonation && session?.session?.impersonatedBy) {
    setWasImpersonation(true)
  }

  const expired = sawSession && !isPending && !error && !session?.user

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

  const subject = wasImpersonation ? 'The impersonation session expired' : 'Your session expired'

  return (
    <main className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[var(--surface-1)] p-6'>
      <p className='text-[var(--text-muted)] text-sm'>
        {failed ? `${subject}, but signing out failed.` : `${subject}. Signing you out…`}
      </p>
      {failed && (
        <Chip variant='primary' onClick={attemptRecovery}>
          Try again
        </Chip>
      )}
    </main>
  )
}
