'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { client } from '@/lib/auth/auth-client'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'

interface ConnectLauncherProps {
  providerId: string
  /** Same-origin path better-auth returns the browser to after the callback. */
  completePath: string
}

/**
 * Starts the better-auth link flow for the requested provider as soon as the
 * page loads — oauth2.link must run client-side so the state cookie lands in
 * this browser, which the OAuth callback requires. On success the browser
 * leaves for the provider immediately, so the UI is just a brief interstitial
 * plus an error state with retry.
 */
export function ConnectLauncher({ providerId, completePath }: ConnectLauncherProps) {
  const startedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      await client.oauth2.link({
        providerId,
        callbackURL: completePath,
        // Failed flows bounce to the same complete page (which forwards the
        // failure to the loopback) instead of waiting out the handoff TTL.
        // Do NOT bake in a query param here: better-auth appends its own
        // `&error=<code>`, and a second `error` key deserializes to an array
        // that the complete page can't read — so it would look like success.
        errorCallbackURL: completePath,
      })
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start the connection.'))
    }
  }, [providerId, completePath])

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
