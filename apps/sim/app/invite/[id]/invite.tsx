'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth/auth-client'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'
import { organizationKeys } from '@/hooks/queries/organization'
import { subscriptionKeys } from '@/hooks/queries/subscription'

const logger = createLogger('InviteById')

type InviteErrorCode =
  | 'missing-token'
  | 'invalid-token'
  | 'expired'
  | 'already-processed'
  | 'email-mismatch'
  | 'workspace-not-found'
  | 'user-not-found'
  | 'already-member'
  | 'already-in-organization'
  | 'no-seats-available'
  | 'invalid-invitation'
  | 'missing-invitation-id'
  | 'server-error'
  | 'unauthorized'
  | 'forbidden'
  | 'network-error'
  | 'unknown'

interface InviteError {
  code: InviteErrorCode
  message: string
  requiresAuth?: boolean
  canRetry?: boolean
}

type InvitationKind = 'organization' | 'workspace'

interface InvitationDetails {
  id: string
  kind: InvitationKind
  email: string
  organizationId: string | null
  organizationName: string | null
  role: string
  status: string
  expiresAt: string
  inviterName: string | null
  inviterEmail: string | null
  grants: Array<{
    workspaceId: string
    workspaceName: string | null
    permission: 'admin' | 'write' | 'read'
  }>
}

function getInviteError(code: string): InviteError {
  const errorMap: Record<string, InviteError> = {
    'missing-token': {
      code: 'missing-token',
      message: 'The invitation link is invalid or missing a required parameter.',
    },
    'invalid-token': {
      code: 'invalid-token',
      message: 'The invitation link is invalid or has already been used.',
    },
    expired: {
      code: 'expired',
      message: 'This invitation has expired. Please ask for a new invitation.',
    },
    'already-processed': {
      code: 'already-processed',
      message: 'This invitation has already been accepted or declined.',
    },
    'email-mismatch': {
      code: 'email-mismatch',
      message:
        'This invitation was sent to a different email address. Please sign in with the correct account.',
      requiresAuth: true,
    },
    'workspace-not-found': {
      code: 'workspace-not-found',
      message: 'The workspace associated with this invitation could not be found.',
    },
    'user-not-found': {
      code: 'user-not-found',
      message: 'Your user account could not be found. Please try signing out and signing back in.',
      requiresAuth: true,
    },
    'already-member': {
      code: 'already-member',
      message: 'You are already a member of this organization or workspace.',
    },
    'already-in-organization': {
      code: 'already-in-organization',
      message:
        'You are already a member of an organization. Leave your current organization before accepting a new invitation.',
    },
    'no-seats-available': {
      code: 'no-seats-available',
      message:
        'This organization has no available seats right now. Ask an admin to add seats or retry after capacity changes.',
    },
    'invalid-invitation': {
      code: 'invalid-invitation',
      message: 'This invitation is invalid or no longer exists.',
    },
    'not-found': {
      code: 'invalid-invitation',
      message: 'This invitation is invalid or no longer exists.',
    },
    'server-error': {
      code: 'server-error',
      message:
        'An unexpected error occurred while processing your invitation. Please try again later.',
      canRetry: true,
    },
    unauthorized: {
      code: 'unauthorized',
      message: 'You need to sign in to accept this invitation.',
      requiresAuth: true,
    },
    forbidden: {
      code: 'forbidden',
      message:
        'You do not have permission to accept this invitation. Please check you are signed in with the correct account.',
      requiresAuth: true,
    },
    'network-error': {
      code: 'network-error',
      message:
        'Unable to connect to the server. Please check your internet connection and try again.',
      canRetry: true,
    },
  }

  return (
    errorMap[code] || {
      code: 'unknown',
      message:
        'An unexpected error occurred while processing your invitation. Please try again or contact support.',
      canRetry: true,
    }
  )
}

function codeFromStatus(status: number): InviteErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'invalid-invitation'
  if (status === 409) return 'already-in-organization'
  if (status >= 500) return 'server-error'
  return 'unknown'
}

export default function Invite() {
  const router = useRouter()
  const params = useParams()
  const inviteId = params.id as string
  const inviteTokenStorageKey = `inviteToken:${inviteId}`
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const queryClient = useQueryClient()
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<InviteError | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [isNewUser, setIsNewUser] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const errorReason = searchParams.get('error')
    const isNew = searchParams.get('new') === 'true'
    setIsNewUser(isNew)

    const tokenFromQuery = searchParams.get('token')
    if (tokenFromQuery) {
      setToken(tokenFromQuery)
      sessionStorage.setItem(inviteTokenStorageKey, tokenFromQuery)
    } else {
      const storedToken = sessionStorage.getItem(inviteTokenStorageKey)
      if (storedToken) {
        setToken(storedToken)
      }
    }

    if (errorReason) {
      setError(getInviteError(errorReason))
      setIsLoading(false)
    }
  }, [searchParams, inviteId, inviteTokenStorageKey])

  useEffect(() => {
    if (!session?.user) return

    async function fetchInvitation() {
      setIsLoading(true)
      try {
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : ''
        const response = await fetch(`/api/invitations/${inviteId}${tokenParam}`)

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          const code = data.error || codeFromStatus(response.status)
          setError(getInviteError(code))
          setIsLoading(false)
          return
        }

        const data = await response.json()
        setInvitation(data.invitation as InvitationDetails)
        setError(null)
      } catch (fetchError) {
        logger.error('Error fetching invitation:', fetchError)
        setError(getInviteError('network-error'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitation()
  }, [session?.user, inviteId, token])

  const handleAcceptInvitation = async () => {
    if (!session?.user || !invitation) return
    setIsAccepting(true)

    try {
      const response = await fetch(`/api/invitations/${inviteId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token ?? undefined }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const code = data.error || codeFromStatus(response.status)
        setError(getInviteError(code))
        setIsAccepting(false)
        return
      }

      const data = await response.json()

      if (invitation.organizationId) {
        try {
          await client.organization.setActive({ organizationId: invitation.organizationId })
        } catch (setActiveError) {
          logger.warn('Failed to set active organization after accept', setActiveError)
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
      ])

      setAccepted(true)
      setIsAccepting(false)

      const redirectPath = typeof data.redirectPath === 'string' ? data.redirectPath : '/workspace'
      setTimeout(() => router.push(redirectPath), 1200)
    } catch (acceptError) {
      logger.error('Error accepting invitation:', acceptError)
      setError(getInviteError('network-error'))
      setIsAccepting(false)
    }
  }

  const getCallbackUrl = () => {
    const effectiveToken =
      token || sessionStorage.getItem(inviteTokenStorageKey) || searchParams.get('token')
    return `/invite/${inviteId}${effectiveToken ? `?token=${effectiveToken}` : ''}`
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
    const callbackUrl = encodeURIComponent(getCallbackUrl())

    if (error.code === 'email-mismatch') {
      return (
        <InviteLayout>
          <InviteStatusCard
            type='warning'
            title='Wrong Account'
            description={error.message}
            icon='userPlus'
            actions={[
              {
                label: 'Sign in with a different account',
                onClick: async () => {
                  await client.signOut()
                  router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`)
                },
              },
              { label: 'Return to Home', onClick: () => router.push('/') },
            ]}
          />
        </InviteLayout>
      )
    }

    if (error.code === 'already-in-organization') {
      return (
        <InviteLayout>
          <InviteStatusCard
            type='warning'
            title='Already Part of a Team'
            description={error.message}
            icon='users'
            actions={[
              { label: 'Manage Team Settings', onClick: () => router.push('/workspace') },
              { label: 'Return to Home', onClick: () => router.push('/') },
            ]}
          />
        </InviteLayout>
      )
    }

    if (error.requiresAuth) {
      return (
        <InviteLayout>
          <InviteStatusCard
            type='warning'
            title='Authentication Required'
            description={error.message}
            icon='userPlus'
            actions={[
              {
                label: 'Sign in to continue',
                onClick: () => router.push(`/login?callbackUrl=${callbackUrl}&invite_flow=true`),
              },
              {
                label: 'Create an account',
                onClick: () => router.push(`/signup?callbackUrl=${callbackUrl}&invite_flow=true`),
              },
              { label: 'Return to Home', onClick: () => router.push('/') },
            ]}
          />
        </InviteLayout>
      )
    }

    const actions: Array<{ label: string; onClick: () => void }> = []
    if (error.canRetry) {
      actions.push({ label: 'Try Again', onClick: () => window.location.reload() })
    }
    actions.push({ label: 'Return to Home', onClick: () => router.push('/') })

    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Invitation Error'
          description={error.message}
          icon='error'
          isExpiredError={error.code === 'expired'}
          actions={actions}
        />
      </InviteLayout>
    )
  }

  const displayName =
    invitation?.kind === 'workspace'
      ? invitation.grants[0]?.workspaceName || 'a workspace'
      : invitation?.organizationName || 'an organization'

  if (accepted) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title='Welcome!'
          description={`You have successfully joined ${displayName}. Redirecting...`}
          icon='success'
          actions={[{ label: 'Return to Home', onClick: () => router.push('/') }]}
        />
      </InviteLayout>
    )
  }

  const isOrg = invitation?.kind === 'organization'

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title={isOrg ? 'Organization Invitation' : 'Workspace Invitation'}
        description={`You've been invited to join ${displayName}. Click accept below to join.`}
        icon={isOrg ? 'users' : 'mail'}
        actions={[
          {
            label: 'Accept Invitation',
            onClick: handleAcceptInvitation,
            disabled: isAccepting,
            loading: isAccepting,
          },
          { label: 'Return to Home', onClick: () => router.push('/') },
        ]}
      />
    </InviteLayout>
  )
}
