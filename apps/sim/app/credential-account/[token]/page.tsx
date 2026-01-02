'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Shield } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'

interface InvitationInfo {
  credentialSetName: string
  organizationName: string
  email: string | null
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
  const [accepted, setAccepted] = useState(false)

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
      router.push(`/login?callbackUrl=${encodeURIComponent(`/credential-account/${token}`)}`)
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

      setAccepted(true)
    } catch {
      setError('Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }, [session?.user?.id, token, router])

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

  if (accepted) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
        <div className='flex max-w-[400px] flex-col items-center gap-[24px] p-[32px]'>
          <CheckCircle2 className='h-[48px] w-[48px] text-green-500' />
          <p className='font-medium text-[20px] text-[var(--text-primary)]'>Welcome!</p>
          <p className='text-center text-[13px] text-[var(--text-secondary)]'>
            You've successfully joined {invitation?.credentialSetName}. Connect your OAuth
            credentials in Settings → Integrations.
          </p>
          <Button variant='tertiary' onClick={() => router.push('/w')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-[var(--bg)]'>
      <div className='w-full max-w-[400px] p-[32px]'>
        <div className='flex flex-col items-center gap-[8px]'>
          <Shield className='h-[48px] w-[48px] text-[var(--brand-400)]' />
          <p className='font-medium text-[20px] text-[var(--text-primary)]'>Join Credential Set</p>
          <p className='text-center text-[13px] text-[var(--text-secondary)]'>
            You've been invited to join{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {invitation?.credentialSetName}
            </span>{' '}
            by {invitation?.organizationName}
          </p>
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
                  'Accept Invitation'
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
          By joining, you agree to share your OAuth credentials with this credential set for use in
          automated workflows.
        </p>
      </div>
    </div>
  )
}
