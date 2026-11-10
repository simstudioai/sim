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
 * Another tab signing in as someone else swaps the shared cookie under this one, so a session
 * that comes back as a different user is the end of this viewer's session too: `leaveForNewUser`
 * drops what this tab holds and reloads, without signing the new user out.
 *
 * `recover` must keep a stable identity, and resolves false when sign-out failed and the surface
 * should offer a retry. `leaveForNewUser` must keep a stable identity too.
 */
export function useSessionExpiry(
  recover: () => Promise<boolean>,
  leaveForNewUser: () => Promise<void>
) {
  const { data: session, isPending, error } = useSession()
  const startedRef = useRef(false)
  const leavingRef = useRef(false)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [wasImpersonation, setWasImpersonation] = useState(false)
  const [failed, setFailed] = useState(false)

  if (viewerId === null && session?.user) {
    setViewerId(session.user.id)
  }
  const sawSession = viewerId !== null
  const userId = session?.user?.id
  const userChanged = sawSession && userId !== undefined && userId !== viewerId
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

  useEffect(() => {
    if (!userChanged || leavingRef.current) return
    leavingRef.current = true
    void leaveForNewUser()
  }, [userChanged, leaveForNewUser])

  return { expired, failed, wasImpersonation, attemptRecovery }
}
