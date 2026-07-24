'use client'

import { useState } from 'react'
import { buildDesktopAuthPath, buildLoopbackUrl } from '@/app/desktop/auth/validation'

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

  const authorize = async () => {
    setStatus('working')
    try {
      const response = await fetch('/api/auth/one-time-token/generate', { method: 'GET' })
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        // Dead or revoked session: re-login, then come back here.
        window.location.assign(
          `/login?callbackUrl=${encodeURIComponent(buildDesktopAuthPath(state, port))}`
        )
        return
      }
      const token = response.ok ? ((await response.json())?.token ?? null) : null
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('Token mint failed')
      }
      window.location.assign(buildLoopbackUrl(token, state, port))
    } catch {
      setStatus('error')
    }
  }

  return (
    <main className='flex min-h-screen items-center justify-center px-6'>
      <div className='max-w-sm text-center'>
        <h1 className='font-semibold text-foreground text-lg'>Sign in to Sim Desktop</h1>
        <p className='mt-2 text-muted-foreground text-sm'>
          {status === 'error'
            ? 'Something went wrong signing in the desktop app. Try again.'
            : `The Sim desktop app on this computer will be signed in as ${email}.`}
        </p>
        <button
          type='button'
          disabled={status === 'working'}
          onClick={() => void authorize()}
          className='mt-4 rounded-md border border-border px-4 py-2 text-foreground text-sm disabled:opacity-50'
        >
          {status === 'working' ? 'Signing in…' : status === 'error' ? 'Try again' : 'Continue'}
        </button>
      </div>
    </main>
  )
}
