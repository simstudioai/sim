'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Mail, UserPlus, Users2 } from 'lucide-react'
import Image from 'next/image'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { client, useSession } from '@/lib/auth-client'
import { useBrandConfig } from '@/lib/branding/branding'

export default function Invite() {
  const router = useRouter()
  const params = useParams()
  const inviteId = params.id as string
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const brandConfig = useBrandConfig()
  const [invitationDetails, setInvitationDetails] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [isNewUser, setIsNewUser] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [invitationType, setInvitationType] = useState<'organization' | 'workspace'>('workspace')

  // Check if this is a new user vs. existing user and get token from query
  useEffect(() => {
    const isNew = searchParams.get('new') === 'true'
    setIsNewUser(isNew)

    // Get token from URL or use inviteId as token
    const tokenFromQuery = searchParams.get('token')
    const effectiveToken = tokenFromQuery || inviteId

    if (effectiveToken) {
      setToken(effectiveToken)
      sessionStorage.setItem('inviteToken', effectiveToken)
    }
  }, [searchParams, inviteId])

  // Auto-fetch invitation details when logged in
  useEffect(() => {
    if (!session?.user || !token) return

    async function fetchInvitationDetails() {
      setIsLoading(true)
      try {
        // First try to fetch workspace invitation details
        const workspaceInviteResponse = await fetch(
          `/api/workspaces/invitations/details?token=${token}`,
          {
            method: 'GET',
          }
        )

        if (workspaceInviteResponse.ok) {
          const data = await workspaceInviteResponse.json()
          setInvitationType('workspace')
          setInvitationDetails({
            type: 'workspace',
            data,
            name: data.workspaceName || 'a workspace',
          })
          setIsLoading(false)
          return
        }

        // If workspace invitation not found, try organization invitation
        try {
          const { data } = await client.organization.getInvitation({
            query: { id: inviteId },
          })

          if (data) {
            setInvitationType('organization')
            setInvitationDetails({
              type: 'organization',
              data,
              name: data.organizationName || 'an organization',
            })

            // Get organization details
            if (data.organizationId) {
              const orgResponse = await client.organization.getFullOrganization({
                query: { organizationId: data.organizationId },
              })

              if (orgResponse.data) {
                setInvitationDetails((prev: any) => ({
                  ...prev,
                  name: orgResponse.data.name || 'an organization',
                }))
              }
            }
          } else {
            throw new Error('Invitation not found or has expired')
          }
        } catch (_err) {
          // If neither workspace nor organization invitation is found
          throw new Error('Invitation not found or has expired')
        }
      } catch (err: any) {
        console.error('Error fetching invitation:', err)
        setError(err.message || 'Failed to load invitation details')
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitationDetails()
  }, [session?.user, inviteId, token])

  // Handle invitation acceptance
  const handleAcceptInvitation = async () => {
    if (!session?.user) return

    setIsAccepting(true)
    try {
      if (invitationType === 'workspace') {
        // For workspace invites, call the API route with token
        const response = await fetch(
          `/api/workspaces/invitations/accept?token=${encodeURIComponent(token || '')}`
        )

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to accept invitation')
        }

        setAccepted(true)

        // Redirect to workspace after a brief delay
        setTimeout(() => {
          router.push('/workspace')
        }, 2000)
      } else {
        // For organization invites, use the client API
        const response = await client.organization.acceptInvitation({
          invitationId: inviteId,
        })

        // Set the active organization to the one just joined
        const orgId =
          response.data?.invitation.organizationId || invitationDetails?.data?.organizationId

        if (orgId) {
          await client.organization.setActive({
            organizationId: orgId,
          })
        }

        setAccepted(true)

        // Redirect to workspace after a brief delay
        setTimeout(() => {
          router.push('/workspace')
        }, 2000)
      }
    } catch (err: any) {
      console.error('Error accepting invitation:', err)
      setError(err.message || 'Failed to accept invitation')
    } finally {
      setIsAccepting(false)
    }
  }

  // Prepare the callback URL - this ensures after login, user returns to invite page
  const getCallbackUrl = () => {
    return `/invite/${inviteId}${token && token !== inviteId ? `?token=${token}` : ''}`
  }

  // Show login/signup prompt if not logged in
  if (!session?.user && !isPending) {
    const callbackUrl = encodeURIComponent(getCallbackUrl())

    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
        <div className='mb-8'>
          <Image
            src={brandConfig.logoUrl || '/logo/b&w/medium.png'}
            alt='Sim Logo'
            width={120}
            height={67}
            className='dark:invert'
            priority
          />
        </div>

        <div className='flex w-full max-w-md flex-col items-center text-center'>
          <div className='mb-6 rounded-full bg-blue-50 p-3 dark:bg-blue-950/20'>
            <UserPlus className='h-8 w-8 text-blue-500 dark:text-blue-400' />
          </div>

          <h1 className='mb-2 font-semibold text-black text-xl dark:text-white'>
            You've been invited!
          </h1>

          <p className='mb-6 text-gray-600 text-sm leading-relaxed dark:text-gray-300'>
            {isNewUser
              ? 'Create an account to join this workspace on Sim'
              : 'Sign in to your account to accept this invitation'}
          </p>

          <div className='flex w-full flex-col gap-3'>
            {isNewUser ? (
              <>
                <Button
                  className='w-full'
                  style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
                  onClick={() => router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true`)}
                >
                  Create an account
                </Button>
                <Button
                  variant='outline'
                  className='w-full border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white'
                  onClick={() => router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`)}
                >
                  I already have an account
                </Button>
              </>
            ) : (
              <>
                <Button
                  className='w-full'
                  style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
                  onClick={() => router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`)}
                >
                  Sign in
                </Button>
                <Button
                  variant='outline'
                  className='w-full border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white'
                  onClick={() =>
                    router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true&new=true`)
                  }
                >
                  Create an account
                </Button>
              </>
            )}

            <Button
              className='w-full'
              style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
              onClick={() => router.push('/')}
            >
              Return to Home
            </Button>
          </div>
        </div>

        <footer className='mt-8 text-center text-gray-500 text-xs'>
          Need help?{' '}
          <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
            Contact support
          </a>
        </footer>
      </div>
    )
  }

  // Show loading state
  if (isLoading || isPending) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
        <div className='mb-8'>
          <Image
            src={brandConfig.logoUrl || '/logo/b&w/medium.png'}
            alt='Sim Logo'
            width={120}
            height={67}
            className='dark:invert'
            priority
          />
        </div>
        <LoadingAgent size='lg' />
        <p className='mt-4 text-gray-400 text-sm'>Loading invitation...</p>

        <footer className='mt-8 text-center text-gray-500 text-xs'>
          Need help?{' '}
          <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
            Contact support
          </a>
        </footer>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
        <div className='mb-8'>
          <Image
            src={brandConfig.logoUrl || '/logo/b&w/medium.png'}
            alt='Sim Logo'
            width={120}
            height={67}
            className='dark:invert'
            priority
          />
        </div>
        <div className='flex w-full max-w-md flex-col items-center text-center'>
          <div className='mb-6 rounded-full bg-red-50 p-3 dark:bg-red-950/20'>
            <AlertCircle className='h-8 w-8 text-red-500 dark:text-red-400' />
          </div>
          <h1 className='mb-2 font-semibold text-black text-xl dark:text-white'>
            Invitation Error
          </h1>
          <p className='mb-6 text-gray-600 text-sm leading-relaxed dark:text-gray-300'>{error}</p>

          <Button
            className='w-full'
            style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
            onClick={() => router.push('/')}
          >
            Return to Home
          </Button>
        </div>

        <footer className='mt-8 text-center text-gray-500 text-xs'>
          Need help?{' '}
          <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
            Contact support
          </a>
        </footer>
      </div>
    )
  }

  // Show success state
  if (accepted) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
        <div className='mb-8'>
          <Image
            src={brandConfig.logoUrl || '/logo/b&w/medium.png'}
            alt='Sim Logo'
            width={120}
            height={67}
            className='dark:invert'
            priority
          />
        </div>
        <div className='flex w-full max-w-md flex-col items-center text-center'>
          <div className='mb-6 rounded-full bg-green-50 p-3 dark:bg-green-950/20'>
            <CheckCircle2 className='h-8 w-8 text-green-500 dark:text-green-400' />
          </div>
          <h1 className='mb-2 font-semibold text-black text-xl dark:text-white'>Welcome!</h1>
          <p className='mb-6 text-gray-600 text-sm leading-relaxed dark:text-gray-300'>
            You have successfully joined {invitationDetails?.name || 'the workspace'}. Redirecting
            to your workspace...
          </p>

          <Button
            className='w-full'
            style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
            onClick={() => router.push('/')}
          >
            Return to Home
          </Button>
        </div>

        <footer className='mt-8 text-center text-gray-500 text-xs'>
          Need help?{' '}
          <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
            Contact support
          </a>
        </footer>
      </div>
    )
  }

  // Show invitation details
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
      <div className='mb-8'>
        <Image
          src='/logo/b&w/medium.png'
          alt='Sim Logo'
          width={120}
          height={67}
          className='dark:invert'
          priority
        />
      </div>

      <div className='flex w-full max-w-md flex-col items-center text-center'>
        <div className='mb-6 rounded-full bg-blue-50 p-3 dark:bg-blue-950/20'>
          {invitationType === 'organization' ? (
            <Users2 className='h-8 w-8 text-blue-500 dark:text-blue-400' />
          ) : (
            <Mail className='h-8 w-8 text-blue-500 dark:text-blue-400' />
          )}
        </div>

        <h1 className='mb-2 font-semibold text-black text-xl dark:text-white'>
          {invitationType === 'organization' ? 'Organization Invitation' : 'Workspace Invitation'}
        </h1>

        <p className='mb-6 text-gray-600 text-sm leading-relaxed dark:text-gray-300'>
          You've been invited to join{' '}
          <span className='font-medium text-black dark:text-white'>
            {invitationDetails?.name || `a ${invitationType}`}
          </span>
          . Click accept below to join.
        </p>

        <div className='flex w-full flex-col gap-3'>
          <Button
            onClick={handleAcceptInvitation}
            disabled={isAccepting}
            className='w-full'
            style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
          >
            {isAccepting ? (
              <>
                <LoadingAgent size='sm' />
                Accepting...
              </>
            ) : (
              'Accept Invitation'
            )}
          </Button>
          <Button
            variant='ghost'
            className='w-full text-gray-600 hover:bg-gray-200 hover:text-black dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
            onClick={() => router.push('/')}
          >
            Return to Home
          </Button>
        </div>
      </div>

      <footer className='mt-8 text-center text-gray-500 text-xs'>
        Need help?{' '}
        <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
          Contact support
        </a>
      </footer>
    </div>
  )
}
