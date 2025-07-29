'use client'

import { useEffect, useState } from 'react'
import { BotIcon, CheckCircle } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { client, useSession } from '@/lib/auth-client'

export default function Invite() {
  const router = useRouter()
  const params = useParams()
  const inviteId = params.id as string
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
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
      <div className='flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4'>
        <Card className='w-full max-w-md p-6'>
          <CardHeader className='px-0 pt-0 text-center'>
            <CardTitle>You've been invited to join a workspace</CardTitle>
            <CardDescription>
              {isNewUser
                ? 'Create an account to join this workspace on Sim'
                : 'Sign in to your account to accept this invitation'}
            </CardDescription>
          </CardHeader>
          <CardFooter className='flex flex-col space-y-2 px-0'>
            {isNewUser ? (
              <>
                <Button
                  className='w-full'
                  onClick={() => router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true`)}
                >
                  Create an account
                </Button>
                <Button
                  variant='outline'
                  className='w-full'
                  onClick={() => router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`)}
                >
                  I already have an account
                </Button>
              </>
            ) : (
              <>
                <Button
                  className='w-full'
                  onClick={() => router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`)}
                >
                  Sign in
                </Button>
                <Button
                  variant='outline'
                  className='w-full'
                  onClick={() =>
                    router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true&new=true`)
                  }
                >
                  Create an account
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>
    )
  }

  // Show loading state
  if (isLoading || isPending) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4'>
        <LoadingAgent size='lg' />
        <p className='mt-4 text-muted-foreground text-sm'>Loading invitation...</p>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4'>
        <Card className='max-w-md space-y-2 p-6 text-center'>
          <div className='flex justify-center'>
            <BotIcon className='h-16 w-16 text-muted-foreground' />
          </div>
          <h3 className='font-semibold text-lg'>Invitation Error</h3>
          <p className='text-muted-foreground'>{error}</p>
        </Card>
      </div>
    )
  }

  // Show success state
  if (accepted) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4'>
        <Card className='max-w-md space-y-2 p-6 text-center'>
          <div className='flex justify-center'>
            <CheckCircle className='h-16 w-16 text-green-500' />
          </div>
          <h3 className='font-semibold text-lg'>Invitation Accepted</h3>
          <p className='text-muted-foreground'>
            You have successfully joined {invitationDetails?.name || 'the workspace'}. Redirecting
            to your workspace...
          </p>
        </Card>
      </div>
    )
  }

  // Show invitation details
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4'>
      <Card className='w-full max-w-md'>
        <CardHeader className='text-center'>
          <CardTitle className='mb-1'>Workspace Invitation</CardTitle>
          <CardDescription className='text-md'>
            You've been invited to join{' '}
            <span className='font-medium'>{invitationDetails?.name || 'a workspace'}</span>
          </CardDescription>
          <p className='mt-2 text-md text-muted-foreground'>
            Click the accept below to join the workspace.
          </p>
        </CardHeader>
        <CardFooter className='flex justify-center'>
          <Button onClick={handleAcceptInvitation} disabled={isAccepting} className='w-full'>
            <span className='ml-2'>{isAccepting ? '' : ''}Accept Invitation</span>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
