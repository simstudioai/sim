'use client'

import { Chip, cn, useNativeSurfaceOcclusionReady } from '@sim/emcn-legacy'
import { useSessionExpiry } from '@/lib/auth/session-expiry'
import { recoverFromStaleSession } from '@/lib/auth/stale-session-recovery'

/**
 * Cleanly logs out when the session dies while the app is mounted.
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
  const { expired, failed, wasImpersonation, attemptRecovery } =
    useSessionExpiry(recoverFromStaleSession)
  const nativeSurfaceReady = useNativeSurfaceOcclusionReady(expired, 'takeover')

  if (!expired) {
    return null
  }

  const subject = wasImpersonation ? 'The impersonation session expired' : 'Your session expired'

  return (
    <main
      className='fixed inset-0 z-[var(--z-takeover)] flex flex-col items-center justify-center gap-3 bg-[var(--bg)] p-6 text-center'
      style={{ visibility: nativeSurfaceReady ? undefined : 'hidden' }}
      data-native-surface-occlusion='takeover'
    >
      <p
        className={cn(
          'text-sm',
          failed ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]'
        )}
      >
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
