'use client'

import { useState } from 'react'
import { AuthIdentity, AuthButton as Chip } from '@sim/auth-ui'
import { requestJson } from '@/lib/api/client/request'
import { startCredentialConnectionContract } from '@/lib/api/contracts/credentials'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'

interface ConnectConfirmationProps {
  email: string
  serviceName: string
  workspaceId: string
  providerId: string
  credentialId?: string
  callbackURL?: string
}

/**
 * The user-gesture gate for a workspace connection: Continue creates the
 * user-bound draft and hands it to the authorize route, which takes the user to
 * the provider.
 */
export function ConnectConfirmation({
  email,
  serviceName,
  workspaceId,
  providerId,
  credentialId,
  callbackURL,
}: ConnectConfirmationProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const connect = async () => {
    if (status === 'working') return
    setStatus('working')
    setErrorMessage(null)
    try {
      const { authorizationUrl } = await requestJson(startCredentialConnectionContract, {
        body: { workspaceId, providerId, credentialId },
      })
      const launch = new URL(authorizationUrl)
      if (callbackURL) launch.searchParams.set('callbackURL', callbackURL)
      window.location.assign(launch.toString())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : null)
      setStatus('error')
    }
  }

  const action = credentialId ? 'Reconnect' : 'Connect'
  return (
    <DesktopHandoffShell
      detail={<AuthIdentity email={email} />}
      title={`${action} ${serviceName}`}
      description={
        status === 'error'
          ? (errorMessage ?? `Something went wrong starting the connection. Try again.`)
          : `Continue to ${serviceName} to approve access for this workspace connection.`
      }
    >
      <Chip
        fullWidth
        variant='primary'
        loading={status === 'working'}
        onClick={() => void connect()}
      >
        {status === 'error' ? 'Try again' : 'Continue'}
      </Chip>
    </DesktopHandoffShell>
  )
}
