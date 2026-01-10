'use client'

import { useCallback, useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { GmailIcon, OutlookIcon } from '@/components/icons'
import { client, useSession } from '@/lib/auth/auth-client'
import { getProviderDisplayName, isPollingProvider } from '@/lib/credential-sets/providers'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'

interface InvitationInfo {
  credentialSetName: string
  organizationName: string
  providerId: string | null
  email: string | null
}

type AcceptedState = 'connecting' | 'already-connected'

export default function CredentialAccountInvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const { data: session, isPending: sessionLoading } = useSession()

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [acceptedState, setAcceptedState] = useState<AcceptedState | null>(null)

  useEffect(() => {
    async function fetchInvitation() {
      try {
        const res = await fetch(`/api/credential-sets/invite/${token}`)
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to load invitation')
          return
        }
        const data = await res.json()
        setInvitation(data.invitation)
      } catch {
        setError('Failed to load invitation')
      } finally {
        setLoading(false)
      }
    }

    fetchInvitation()
  }, [token])

  const handleAccept = useCallback(async () => {
    if (!session?.user?.id) {
      // Include invite_flow=true so the login page preserves callbackUrl when linking to signup
      const callbackUrl = encodeURIComponent(`/credential-account/${token}`)
      router.push(`/login?invite_flow=true&callbackUrl=${callbackUrl}`)
      return
    }

    setAccepting(true)
    try {
      const res = await fetch(`/api/credential-sets/invite/${token}`, {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to accept invitation')
        return
      }

      const data = await res.json()
      const credentialSetProviderId = data.providerId || invitation?.providerId

      // Check if user already has this provider connected
      let isAlreadyConnected = false
      if (credentialSetProviderId && isPollingProvider(credentialSetProviderId)) {
        try {
          const connectionsRes = await fetch('/api/auth/oauth/connections')
          if (connectionsRes.ok) {
            const connectionsData = await connectionsRes.json()
            const connections = connectionsData.connections || []
            isAlreadyConnected = connections.some(
              (conn: { provider: string; accounts?: { id: string }[] }) =>
                conn.provider === credentialSetProviderId &&
                conn.accounts &&
                conn.accounts.length > 0
            )
          }
        } catch {
          // If we can't check connections, proceed with OAuth flow
        }
      }

      if (isAlreadyConnected) {
        // Already connected - redirect to workspace
        setAcceptedState('already-connected')
        setTimeout(() => {
          router.push('/workspace')
        }, 2000)
      } else if (credentialSetProviderId && isPollingProvider(credentialSetProviderId)) {
        // Not connected - start OAuth flow
        setAcceptedState('connecting')

        // Small delay to show success message before redirect
        setTimeout(async () => {
          try {
            await client.oauth2.link({
              providerId: credentialSetProviderId,
              callbackURL: `${window.location.origin}/workspace`,
            })
          } catch (oauthError) {
            // OAuth redirect will happen, this catch is for any pre-redirect errors
            console.error('OAuth initiation error:', oauthError)
            // If OAuth fails, redirect to workspace where they can connect manually
            router.push('/workspace')
          }
        }, 1500)
      } else {
        // No provider specified - just redirect to workspace
        router.push('/workspace')
      }
    } catch {
      setError('Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }, [session?.user?.id, token, router, invitation?.providerId])

  const providerName = invitation?.providerId
    ? getProviderDisplayName(invitation.providerId)
    : 'email'

  const ProviderIcon =
    invitation?.providerId === 'outlook'
      ? OutlookIcon
      : invitation?.providerId === 'google-email'
        ? GmailIcon
        : Mail

  const providerWithIcon = (
    <span className='inline-flex items-baseline gap-1'>
      <ProviderIcon className='inline-block h-4 w-4 translate-y-[2px]' />
      {providerName}
    </span>
  )

  const getCallbackUrl = () => `/credential-account/${token}`

  if (loading || sessionLoading) {
    return (
      <InviteLayout>
        <InviteStatusCard type='loading' title='' description='Loading invitation...' />
      </InviteLayout>
    )
  }

  if (error) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Unable to load invitation'
          description={error}
          icon='error'
          actions={[
            {
              label: 'Return to Home',
              onClick: () => router.push('/'),
            },
          ]}
        />
      </InviteLayout>
    )
  }

  if (acceptedState === 'already-connected') {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title="You're all set!"
          description={`You've joined ${invitation?.credentialSetName}. Your ${providerName} account is already connected. Redirecting to workspace...`}
          icon='success'
        />
      </InviteLayout>
    )
  }

  if (acceptedState === 'connecting') {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='loading'
          title={`Connecting to ${providerName}...`}
          description={`You've joined ${invitation?.credentialSetName}. You'll be redirected to connect your ${providerName} account.`}
        />
      </InviteLayout>
    )
  }

  // Not logged in
  if (!session?.user) {
    const callbackUrl = encodeURIComponent(getCallbackUrl())

    return (
      <InviteLayout>
        <InviteStatusCard
          type='login'
          title='Join Email Polling Group'
          description={`You've been invited to join ${invitation?.credentialSetName} by ${invitation?.organizationName}. Sign in or create an account to accept this invitation.`}
          icon='mail'
          actions={[
            {
              label: 'Sign in',
              onClick: () => router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`),
            },
            {
              label: 'Create an account',
              onClick: () =>
                router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true&new=true`),
            },
            {
              label: 'Return to Home',
              onClick: () => router.push('/'),
            },
          ]}
        />
      </InviteLayout>
    )
  }

  // Logged in - show invitation
  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title='Join Email Polling Group'
        description={
          <>
            You've been invited to join {invitation?.credentialSetName} by{' '}
            {invitation?.organizationName}.
            {invitation?.providerId && (
              <> You'll be asked to connect your {providerWithIcon} account after accepting.</>
            )}
          </>
        }
        icon='mail'
        actions={[
          {
            label: `Accept & Connect ${providerName}`,
            onClick: handleAccept,
            disabled: accepting,
            loading: accepting,
          },
          {
            label: 'Return to Home',
            onClick: () => router.push('/'),
          },
        ]}
      />
    </InviteLayout>
  )
}
