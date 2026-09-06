'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn'
import { signOut } from '@/lib/auth/auth-client'

interface SwitchAccountProps {
  /** Where to return once the right account is signed in. */
  returnTo: string
}

/**
 * Signs this browser out, then sends it to login with the connect flow as the
 * callback.
 *
 * A plain link to `/login` would not work: the middleware bounces `/login` back
 * to the app entry while any session cookie is set, so the wrong account has to
 * be cleared before the login page is reachable at all. For the same reason a
 * failed sign-out must not navigate — it would land the user right back where
 * they started with no explanation.
 */
export function SwitchAccount({ returnTo }: SwitchAccountProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')

  const switchAccount = async () => {
    setStatus('working')
    try {
      await signOut()
    } catch {
      setStatus('error')
      return
    }
    window.location.assign(`/login?callbackUrl=${encodeURIComponent(returnTo)}`)
  }

  return (
    <Chip variant='primary' disabled={status === 'working'} onClick={() => void switchAccount()}>
      {status === 'working'
        ? 'Signing out…'
        : status === 'error'
          ? 'Could not sign out — try again'
          : 'Switch account'}
    </Chip>
  )
}
