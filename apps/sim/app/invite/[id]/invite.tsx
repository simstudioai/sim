'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getErrorMessage } from '@/app/invite/[id]/utils'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'

const logger = createLogger('InviteById')

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

  useEffect(() => {
    const errorReason = searchParams.get('error')

    if (errorReason) {
      setError(getErrorMessage(errorReason))
      setIsLoading(false)
      return
    }

    const isNew = searchParams.get('new') === 'true'
    setIsNewUser(isNew)

    const tokenFromQuery = searchParams.get('token')
    const effectiveToken = tokenFromQuery || inviteId

    if (effectiveToken) {
      setToken(effectiveToken)
      sessionStorage.setItem('inviteToken', effectiveToken)
    }
  }, [searchParams, inviteId])

  useEffect(() => {
    if (!session?.user || !token) return

    async function fetchInvitationDetails() {
      setIsLoading(true)
      try {
        // Fetch invitation details using the invitation ID from the URL path
        const workspaceInviteResponse = await fetch(`/api/workspaces/invitations/${inviteId}`, {
          method: 'GET',
        })

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
          throw new Error('Invitation not found or has expired')
        }
      } catch (err: any) {
        logger.error('Error fetching invitation:', err)
        setError(err.message || 'Failed to load invitation details')
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitationDetails()
  }, [session?.user, inviteId, token])

  const handleAcceptInvitation = async () => {
    if (!session?.user) return

    setIsAccepting(true)

    if (invitationType === 'workspace') {
      window.location.href = `/api/workspaces/invitations/${encodeURIComponent(inviteId)}?token=${encodeURIComponent(token || '')}`
    } else {
      try {
        const response = await client.organization.acceptInvitation({
          invitationId: inviteId,
        })

        const orgId =
          response.data?.invitation.organizationId || invitationDetails?.data?.organizationId

        if (orgId) {
          await client.organization.setActive({
            organizationId: orgId,
          })
        }

        setAccepted(true)

        setTimeout(() => {
          router.push('/workspace')
        }, 2000)
      } catch (err: any) {
        logger.error('Error accepting invitation:', err)
        setError(err.message || 'Failed to accept invitation')
      } finally {
        setIsAccepting(false)
      }
    }
  }

  const getCallbackUrl = () => {
    return `/invite/${inviteId}${token && token !== inviteId ? `?token=${token}` : ''}`
  }

  if (!session?.user && !isPending) {
    const callbackUrl = encodeURIComponent(getCallbackUrl())

    return (
      <InviteLayout>
        <InviteStatusCard
          type='login'
          title="You've been invited!"
          description={
            isNewUser
              ? 'Create an account to join this workspace on Sim'
              : 'Sign in to your account to accept this invitation'
          }
          icon='userPlus'
          actions={[
            ...(isNewUser
              ? [
                  {
                    label: 'Create an account',
                    onClick: () =>
                      router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true`),
                  },
                  {
                    label: 'I already have an account',
                    onClick: () =>
                      router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`),
                    variant: 'outline' as const,
                  },
                ]
              : [
                  {
                    label: 'Sign in',
                    onClick: () =>
                      router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`),
                  },
                  {
                    label: 'Create an account',
                    onClick: () =>
                      router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true&new=true`),
                    variant: 'outline' as const,
                  },
                ]),
            {
              label: 'Return to Home',
              onClick: () => router.push('/'),
            },
          ]}
        />
      </InviteLayout>
    )
  }

  if (isLoading || isPending) {
    return (
      <InviteLayout>
        <InviteStatusCard type='loading' title='' description='Loading invitation...' />
      </InviteLayout>
    )
  }

  if (error) {
    const errorReason = searchParams.get('error')
    const isExpiredError = errorReason === 'expired'

    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Invitation Error'
          description={error}
          icon='error'
          isExpiredError={isExpiredError}
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

  if (accepted) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title='Welcome!'
          description={`You have successfully joined ${invitationDetails?.name || 'the workspace'}. Redirecting to your workspace...`}
          icon='success'
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

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title={
          invitationType === 'organization' ? 'Organization Invitation' : 'Workspace Invitation'
        }
        description={`You've been invited to join ${invitationDetails?.name || `a ${invitationType}`}. Click accept below to join.`}
        icon={invitationType === 'organization' ? 'users' : 'mail'}
        actions={[
          {
            label: 'Accept Invitation',
            onClick: handleAcceptInvitation,
            disabled: isAccepting,
            loading: isAccepting,
          },
          {
            label: 'Return to Home',
            onClick: () => router.push('/'),
            variant: 'ghost',
          },
        ]}
      />
    </InviteLayout>
  )
}
