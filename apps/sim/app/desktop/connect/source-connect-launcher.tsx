'use client'

import { useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { startDesktopSourceBrowser } from '@/lib/desktop/source-browser'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'
import { buildConnectCompletePath } from '@/app/desktop/connect/validation'

interface SourceConnectLauncherProps {
  requestId: string
  state: string
  port: number
}

export function SourceConnectLauncher({ requestId, state, port }: SourceConnectLauncherProps) {
  const started = useRef<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void startDesktopSourceBrowser(requestId, state, port).catch((failure) => {
      setError(getErrorMessage(failure, 'Could not start this connection. Try again from Sim.'))
    })
  }, [requestId, state, port])
  return (
    <DesktopHandoffShell
      title={error ? 'Could not connect' : 'Connecting your account'}
      description={
        error ??
        'Continue authorization here. You’ll return to the Sim desktop app when you’re done.'
      }
    >
      {error && (
        <Chip
          onClick={() =>
            window.location.replace(
              `${buildConnectCompletePath(state, port)}&error=connection_failed`
            )
          }
        >
          Return to Sim
        </Chip>
      )}
    </DesktopHandoffShell>
  )
}
