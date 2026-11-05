'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/lib/auth/client'

/**
 * Notices a session dying while the app is mounted, and recovers from it.
 *
 * A surface's auth gate is a Server Component, so it only re-evaluates on a server render — a
 * session that expires or is revoked mid-visit leaves the SPA mounted and silently failing every
 * request, with nothing to redirect it. This watches the canonical session query for that
 * transition instead.
 *
 * Detection keys off the transition, never off a single failed request: it activates only once a
 * session that was live settles to `null`. A signed-out visitor never arms it (there was no session
 * to lose), and `error` is excluded so an offline blip or a 5xx can never masquerade as an expiry.
 *
 * `recover` must keep a stable identity, and resolves false when sign-out failed and the surface
 * should offer a retry.
 */
export function useSessionExpiry(recover: () => Promise<boolean>) {
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
    void recover().then((recovered) => {
      if (!recovered) setFailed(true)
    })
  }, [recover])

  useEffect(() => {
    if (!expired || startedRef.current) return
    startedRef.current = true
    attemptRecovery()
  }, [expired, attemptRecovery])

  return { expired, failed, wasImpersonation, attemptRecovery }
}
