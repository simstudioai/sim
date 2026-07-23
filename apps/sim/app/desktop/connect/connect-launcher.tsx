'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { client } from '@/lib/auth/auth-client'

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

  return (
    <main className='flex min-h-screen items-center justify-center px-6'>
      <div className='max-w-sm text-center'>
        {error ? (
          <>
            <h1 className='font-semibold text-foreground text-lg'>Connection failed to start</h1>
            <p className='mt-2 text-muted-foreground text-sm'>{error}</p>
            <button
              type='button'
              onClick={() => void start()}
              className='mt-4 rounded-md border border-border px-4 py-2 text-foreground text-sm'
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className='font-semibold text-foreground text-lg'>Connecting your account</h1>
            <p className='mt-2 text-muted-foreground text-sm'>
              Taking you to the provider to authorize Sim…
            </p>
          </>
        )}
      </div>
    </main>
  )
}
