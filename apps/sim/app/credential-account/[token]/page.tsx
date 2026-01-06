'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { GmailIcon, OutlookIcon } from '@/components/icons'
import { client, useSession } from '@/lib/auth/auth-client'

interface InvitationInfo {
  credentialSetName: string
  organizationName: string
  providerId: string | null
  email: string | null
}

type AcceptedState = 'connecting' | 'already-connected'

/**
 * Maps credential set provider IDs to OAuth provider IDs
 * The credential set stores 'gmail' but the OAuth provider is 'google-email'
 */
function getOAuthProviderId(credentialSetProviderId: string): string {
  if (credentialSetProviderId === 'gmail') {
    return 'google-email'
  }
  // outlook is the same in both
  return credentialSetProviderId
}

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
      if (credentialSetProviderId) {
        const oauthProviderId = getOAuthProviderId(credentialSetProviderId)
        try {
          const connectionsRes = await fetch('/api/auth/oauth/connections')
          if (connectionsRes.ok) {
            const connectionsData = await connectionsRes.json()
            const connections = connectionsData.connections || []
            isAlreadyConnected = connections.some(
              (conn: { provider: string; accounts?: { id: string }[] }) =>
                conn.provider === oauthProviderId && conn.accounts && conn.accounts.length > 0
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
      } else if (credentialSetProviderId === 'gmail' || credentialSetProviderId === 'outlook') {
        // Not connected - start OAuth flow
        setAcceptedState('connecting')

        // Small delay to show success message before redirect
        setTimeout(async () => {
          try {
            const oauthProviderId = getOAuthProviderId(credentialSetProviderId)
            await client.oauth2.link({
              providerId: oauthProviderId,
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

  if (loading || sessionLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
        <Loader2 className='h-[32px] w-[32px] animate-spin text-[var(--text-muted)]' />
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
        <div className='flex flex-col items-center gap-[16px]'>
          <AlertCircle className='h-[48px] w-[48px] text-[var(--text-error)]' />
          <p className='font-medium text-[18px] text-[var(--text-primary)]'>
            Unable to load invitation
          </p>
          <p className='text-[13px] text-[var(--text-secondary)]'>{error}</p>
        </div>
      </div>
    )
  }

  const ProviderIcon =
    invitation?.providerId === 'outlook'
      ? OutlookIcon
      : invitation?.providerId === 'gmail'
        ? GmailIcon
        : Mail
  const providerName =
    invitation?.providerId === 'outlook'
      ? 'Outlook'
      : invitation?.providerId === 'gmail'
        ? 'Gmail'
        : 'email'

  if (acceptedState === 'already-connected') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
        <div className='flex max-w-[400px] flex-col items-center gap-[24px] p-[32px]'>
          <CheckCircle2 className='h-[48px] w-[48px] text-green-500' />
          <p className='font-medium text-[20px] text-[var(--text-primary)]'>You're all set!</p>
          <p className='text-center text-[13px] text-[var(--text-secondary)]'>
            You've joined {invitation?.credentialSetName}. Your {providerName} account is already
            connected.
          </p>
          <p className='text-[12px] text-[var(--text-tertiary)]'>Redirecting to workspace...</p>
          <Loader2 className='h-[24px] w-[24px] animate-spin text-[var(--text-muted)]' />
        </div>
      </div>
    )
  }

  if (acceptedState === 'connecting') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
        <div className='flex max-w-[400px] flex-col items-center gap-[24px] p-[32px]'>
          <ProviderIcon className='h-[48px] w-[48px]' />
          <p className='font-medium text-[20px] text-[var(--text-primary)]'>
            Connecting to {providerName}...
          </p>
          <p className='text-center text-[13px] text-[var(--text-secondary)]'>
            You've joined {invitation?.credentialSetName}. You'll be redirected to connect your{' '}
            {providerName} account.
          </p>
          <Loader2 className='h-[24px] w-[24px] animate-spin text-[var(--text-muted)]' />
        </div>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
      <div className='w-full max-w-[400px] p-[32px]'>
        <div className='flex flex-col items-center gap-[8px]'>
          <ProviderIcon className='h-[48px] w-[48px]' />
          <p className='font-medium text-[20px] text-[var(--text-primary)]'>
            Join Email Polling Group
          </p>
          <p className='text-center text-[13px] text-[var(--text-secondary)]'>
            You've been invited to join{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {invitation?.credentialSetName}
            </span>{' '}
            by {invitation?.organizationName}
          </p>
          {invitation?.providerId && (
            <p className='mt-[8px] text-center text-[12px] text-[var(--text-tertiary)]'>
              You'll be asked to connect your {providerName} account after accepting.
            </p>
          )}
        </div>

        <div className='mt-[32px] flex flex-col gap-[16px]'>
          {session?.user ? (
            <>
              <p className='text-center text-[13px] text-[var(--text-secondary)]'>
                Logged in as{' '}
                <span className='font-medium text-[var(--text-primary)]'>{session.user.email}</span>
              </p>
              <Button variant='tertiary' onClick={handleAccept} disabled={accepting}>
                {accepting ? (
                  <>
                    <Loader2 className='mr-[8px] h-[14px] w-[14px] animate-spin' />
                    Joining...
                  </>
                ) : (
                  <>
                    <ProviderIcon className='mr-[8px] h-[16px] w-[16px]' />
                    Accept & Connect {providerName}
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <p className='text-center text-[13px] text-[var(--text-secondary)]'>
                Sign in or create an account to accept this invitation
              </p>
              <Button variant='tertiary' onClick={handleAccept}>
                Continue
              </Button>
            </>
          )}
        </div>

        <p className='mt-[24px] text-center text-[11px] text-[var(--text-muted)]'>
          By joining, you agree to share your {providerName} credentials with this polling group for
          use in automated email workflows.
        </p>
      </div>
    </div>
  )
}
