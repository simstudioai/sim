'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ShellGate } from '@/platform/app/_components/shell-gate/shell-gate'
import { signOutAndLeave } from '@/platform/lib/data/session'

async function leave(loginHref: string, onFailure: () => void) {
  if (!(await signOutAndLeave(loginHref))) onFailure()
}

/**
 * The browser still sends a session cookie the server no longer accepts, as an expired impersonation
 * leaves behind. Login would bounce straight back here while that cookie exists, so sign out first,
 * which clears it, then leave for login.
 */
export function StaleSession({ loginHref }: { loginHref: string }) {
  const [failed, setFailed] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void leave(loginHref, () => setFailed(true))
  }, [loginHref])
  if (!failed) return null
  return (
    <ShellGate
      fullPage
      title='Your session expired'
      description='Sim could not sign you out to start a new session. Try again, or clear this site’s cookies.'
    >
      <Button
        variant='primary'
        onClick={() => {
          setFailed(false)
          void leave(loginHref, () => setFailed(true))
        }}
      >
        Try again
      </Button>
    </ShellGate>
  )
}
