'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { createDesktopHandoffTokenContract } from '@/lib/api/contracts/desktop-auth'
import { buildDesktopAuthPath, buildLoopbackUrl } from '@/app/desktop/auth/validation'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'

interface AuthorizeHandoffProps {
  state: string
  port: number
  email: string
}

/**
 * Explicit user-gesture gate for the desktop session handoff. The one-time
 * token is minted only after the signed-in user clicks Continue — a bare GET
 * of /desktop/auth must never mint one, because state and port are
 * attacker-choosable in a crafted link and whoever holds the loopback port
 * receives a redeemable session token (RFC 8252 §8.10).
 */
export function AuthorizeHandoff({ state, port, email }: AuthorizeHandoffProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const authorize = async () => {
    setStatus('working')
    setErrorMessage(null)
    try {
      const { token } = await requestJson(createDesktopHandoffTokenContract, {})
      window.location.assign(buildLoopbackUrl(token, state, port))
    } catch (error) {
      if (isApiClientError(error) && error.status === 401) {
        // The session died between rendering this page and the click: re-login,
        // then come back here to finish the handoff.
        window.location.assign(
          `/login?callbackUrl=${encodeURIComponent(buildDesktopAuthPath(state, port))}`
        )
        return
      }
      // A 403 means the account is refused outright (access control), which no
      // amount of retrying fixes — show what the server said instead of the
      // generic "try again".
      if (isApiClientError(error) && error.status === 403) {
        setErrorMessage(error.message)
      }
      setStatus('error')
    }
  }

  return (
    <DesktopHandoffShell
      title='Sign in to Sim Desktop'
      description={
        status === 'error'
          ? (errorMessage ?? 'Something went wrong signing in the desktop app. Try again.')
          : `The Sim desktop app on this computer will be signed in as ${email}.`
      }
    >
      <Chip variant='primary' disabled={status === 'working'} onClick={() => void authorize()}>
        {status === 'working' ? 'Signing in…' : status === 'error' ? 'Try again' : 'Continue'}
      </Chip>
    </DesktopHandoffShell>
  )
}
