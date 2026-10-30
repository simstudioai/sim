'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthButton as Chip } from '@sim/auth-ui'
import { getErrorMessage } from '@sim/utils/errors'
import { client } from '@/lib/auth/client'
import { getPerRequestOAuthLinkScopes } from '@/lib/oauth/utils'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'

interface ConnectLauncherProps {
  providerId: string
  /**
   * Absolute URL better-auth returns the browser to after the callback. Better
   * Auth stores it verbatim in the OAuth state and the callback reads the
   * credential draft back off it, so a bare path would be parsed without an
   * origin — keep this a full URL, as every other connect surface passes.
   */
  completeUrl: string
}

/**
 * Starts the better-auth link flow for the requested provider as soon as the
 * page loads — linkSocial must run client-side so the state cookie lands in
 * this browser, which the OAuth callback requires. On success the browser
 * leaves for the provider immediately, so the UI is just a brief interstitial
 * plus an error state with retry.
 */
export function ConnectLauncher({ providerId, completeUrl }: ConnectLauncherProps) {
  const startedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      const scopes = getPerRequestOAuthLinkScopes(providerId)
      const result = await client.linkSocial({
        provider: providerId,
        callbackURL: completeUrl,
        ...(scopes && { scopes }),
        // Failed flows bounce to the same complete page (which forwards the
        // failure to the loopback) instead of waiting out the handoff TTL.
        // Do NOT bake in a query param here: better-auth appends its own
        // `&error=<code>`, and a second `error` key deserializes to an array
        // that the complete page can't read — so it would look like success.
        errorCallbackURL: completeUrl,
      })
      if (result.error) {
        setError(getErrorMessage(result.error.message, 'Could not start the connection.'))
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start the connection.'))
    }
  }, [providerId, completeUrl])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  if (error) {
    return (
      <DesktopHandoffShell title='Connection failed to start' description={error}>
        <Chip variant='primary' onClick={() => void start()}>
          Try again
        </Chip>
      </DesktopHandoffShell>
    )
  }

  return (
    <DesktopHandoffShell
      title='Connecting your account'
      description='Taking you to the provider to authorize Sim…'
    />
  )
}
