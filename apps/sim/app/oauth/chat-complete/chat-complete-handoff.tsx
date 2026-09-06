'use client'

import { useEffect, useRef } from 'react'
import {
  OAUTH_CHAT_ATTEMPT_PARAM,
  OAUTH_CHAT_RETURN_TO_PARAM,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

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
 * listener — then closes the window. Renders nothing, so the page's frame
 * paints as server markup before this hydrates.
 *
 * Reaching this page IS the verdict: Better Auth routes a flow here only as its
 * success `callbackURL`, sending failures to `/oauth-error` or back here with
 * an `error` code. That beats diffing the credential list, which calls a
 * re-authorized account a failure — that path updates the existing account row
 * and creates nothing for a diff to find.
 *
 * A window the browser refuses to close redirects to the chat instead (the
 * popup-blocked path opens this leg in a tab, which no script may close). That
 * URL carries no attempt id on purpose: the verdict is already published, and
 * the destination would otherwise re-decide it by the very diff above.
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
      window.location.replace(returnTo ?? APP_ENTRY_PATH)
    }, CLOSE_FALLBACK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return null
}
