'use client'

import { useEffect, useRef } from 'react'
import {
  OAUTH_CHAT_ATTEMPT_PARAM,
  OAUTH_CHAT_RETURN_TO_PARAM,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'

const CLOSE_FALLBACK_DELAY_MS = 400

/**
 * The fallback redirect must never leave this origin — the target rides in a
 * query param the user could have tampered with.
 */
function sanitizeReturnTo(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Behavior half of the chat OAuth return leg: publishes the verdict to the
 * attempt record — which the chat tab's chip picks up over its storage
 * listener — then closes the window. Renders nothing, so the page's frame is
 * plain server-rendered markup that paints before this hydrates.
 *
 * Reaching this page IS the verdict. Better Auth routes a flow here only as
 * its success `callbackURL`, sending failures to `onAPIError.errorURL`
 * (`/oauth-error`) or back here with an `error` code, so the server has
 * already decided by the time this runs. That is a strictly better signal than
 * the credential diffing the generic-page return does: re-authorizing an
 * already-linked account updates the account row instead of creating one, so
 * no new credential appears and a diff would call a perfectly good connect a
 * failure.
 *
 * A window the browser refuses to close redirects on to the chat surface
 * instead. That is the popup-blocked path: the anchor's `target='_blank'`
 * opens this leg in a new tab, which no script may close. That URL
 * deliberately carries no attempt id — the verdict is already published, and
 * the destination's return router would otherwise re-decide it by the very
 * diff this page exists to avoid.
 */
export function ChatCompleteHandoff() {
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const params = new URL(window.location.href).searchParams
    const attemptId = params.get(OAUTH_CHAT_ATTEMPT_PARAM)
    const returnTo = sanitizeReturnTo(params.get(OAUTH_CHAT_RETURN_TO_PARAM))

    if (attemptId) {
      setOAuthChatAttemptStatus(attemptId, params.has('error') ? 'failed' : 'connected')
    }

    window.close()
    const timer = window.setTimeout(() => {
      window.location.replace(returnTo ?? '/workspace')
    }, CLOSE_FALLBACK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return null
}
