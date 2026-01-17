'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth/auth-client'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'

const logger = createLogger('InviteById')

/** Error codes that can occur during invitation processing */
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

/**
 * Maps error codes to user-friendly error objects with contextual information
 */
function getInviteError(reason: string): InviteError {
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
    'invalid-invitation': {
      code: 'invalid-invitation',
      message: 'This invitation is invalid or no longer exists.',
    },
    'missing-invitation-id': {
      code: 'missing-invitation-id',
      message:
        'The invitation link is missing required information. Please use the original invitation link.',
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
    errorMap[reason] || {
      code: 'unknown',
      message:
        'An unexpected error occurred while processing your invitation. Please try again or contact support.',
      canRetry: true,
    }
  )
}

/**
 * Parses API error responses and extracts a standardized error code
 */
function parseApiError(error: unknown, statusCode?: number): InviteErrorCode {
  // Handle network/fetch errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return 'network-error'
  }

  // Handle error message patterns first (more specific matching)
  const errorMessage =
    typeof error === 'string' ? error.toLowerCase() : (error as Error)?.message?.toLowerCase() || ''

  // Check specific patterns before falling back to status codes
  // Order matters: more specific patterns must come first
  if (errorMessage.includes('already a member of an organization')) return 'already-in-organization'
  if (errorMessage.includes('already a member')) return 'already-member'
  if (errorMessage.includes('email mismatch') || errorMessage.includes('different email'))
    return 'email-mismatch'
  if (errorMessage.includes('already processed')) return 'already-processed'
  if (errorMessage.includes('unauthorized')) return 'unauthorized'
  if (errorMessage.includes('forbidden') || errorMessage.includes('permission')) return 'forbidden'
  if (errorMessage.includes('not found') || errorMessage.includes('expired'))
    return 'invalid-invitation'

  // Handle HTTP status codes as fallback
  if (statusCode) {
    if (statusCode === 401) return 'unauthorized'
    if (statusCode === 403) return 'forbidden'
    if (statusCode === 404) return 'invalid-invitation'
    if (statusCode === 409) return 'already-in-organization'
    if (statusCode >= 500) return 'server-error'
  }

  return 'unknown'
}

export default function Invite() {
  const router = useRouter()
  const params = useParams()
  const inviteId = params.id as string
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const [invitationDetails, setInvitationDetails] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<InviteError | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [isNewUser, setIsNewUser] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [invitationType, setInvitationType] = useState<'organization' | 'workspace'>('workspace')
  const [currentOrgName, setCurrentOrgName] = useState<string | null>(null)

  useEffect(() => {
    const errorReason = searchParams.get('error')
    const isNew = searchParams.get('new') === 'true'
    setIsNewUser(isNew)

    const tokenFromQuery = searchParams.get('token')
    if (tokenFromQuery) {
      setToken(tokenFromQuery)
      sessionStorage.setItem('inviteToken', tokenFromQuery)
    } else {
      const storedToken = sessionStorage.getItem('inviteToken')
      if (storedToken && storedToken !== inviteId) {
        setToken(storedToken)
      }
    }

    if (errorReason) {
      setError(getInviteError(errorReason))
      setIsLoading(false)
      return
    }
  }, [searchParams, inviteId])

  useEffect(() => {
    if (!session?.user || !token) return

    async function fetchInvitationDetails() {
      setIsLoading(true)
      try {
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

        if (!workspaceInviteResponse.ok && workspaceInviteResponse.status !== 404) {
          const errorCode = parseApiError(null, workspaceInviteResponse.status)
          const errorData = await workspaceInviteResponse.json().catch(() => ({}))
          logger.error('Workspace invitation fetch failed:', {
            status: workspaceInviteResponse.status,
            error: errorData,
          })

          if (errorData.error) {
            const refinedCode = parseApiError(errorData.error, workspaceInviteResponse.status)
            setError(getInviteError(refinedCode))
          } else {
            setError(getInviteError(errorCode))
          }
          setIsLoading(false)
          return
        }

        try {
          const { data, error: orgError } = await client.organization.getInvitation({
            query: { id: inviteId },
          })

          if (orgError) {
            logger.error('Organization invitation fetch error:', orgError)
            const errorCode = parseApiError(orgError.message || orgError)
            throw { code: errorCode, original: orgError }
          }

          if (data) {
            setInvitationType('organization')

            const activeOrgResponse = await client.organization
              .getFullOrganization()
              .catch(() => ({ data: null }))

            if (activeOrgResponse?.data) {
              setCurrentOrgName(activeOrgResponse.data.name)
              setError(getInviteError('already-in-organization'))
              setIsLoading(false)
              return
            }

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
            throw { code: 'invalid-invitation' }
          }
        } catch (orgErr: any) {
          if (orgErr.code) {
            throw orgErr
          }
          throw { code: parseApiError(orgErr) }
        }
      } catch (err: any) {
        logger.error('Error fetching invitation:', err)
        const errorCode = err.code || parseApiError(err)
        setError(getInviteError(errorCode))
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
        const orgId = invitationDetails?.data?.organizationId

        if (!orgId) {
          setError(getInviteError('invalid-invitation'))
          setIsAccepting(false)
          return
        }

        const response = await fetch(`/api/organizations/${orgId}/invitations/${inviteId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ status: 'accepted' }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          const errorCode = parseApiError(data.error || '', response.status)
          logger.error('Failed to accept organization invitation:', {
            status: response.status,
            error: data,
          })
          setError(getInviteError(errorCode))
          setIsAccepting(false)
          return
        }

        await client.organization.setActive({
          organizationId: orgId,
        })

        setAccepted(true)

        setTimeout(() => {
          router.push('/workspace')
        }, 2000)
      } catch (err: any) {
        logger.error('Error accepting invitation:', err)

        setAccepted(false)

        const errorCode = parseApiError(err)
        setError(getInviteError(errorCode))
        setIsAccepting(false)
      }
    }
  }

  const getCallbackUrl = () => {
    const effectiveToken =
      token || sessionStorage.getItem('inviteToken') || searchParams.get('token')
    return `/invite/${inviteId}${effectiveToken && effectiveToken !== inviteId ? `?token=${effectiveToken}` : ''}`
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

    if (error.code === 'already-in-organization') {
      return (
        <InviteLayout>
          <InviteStatusCard
            type='warning'
            title='Already Part of a Team'
            description={
              currentOrgName
                ? `You are currently a member of "${currentOrgName}". You must leave your current organization before accepting a new invitation.`
                : error.message
            }
            icon='users'
            actions={[
              {
                label: 'Manage Team Settings',
                onClick: () => router.push('/workspace'),
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
              {
                label: 'Return to Home',
                onClick: () => router.push('/'),
              },
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
              {
                label: 'Return to Home',
                onClick: () => router.push('/'),
              },
            ]}
          />
        </InviteLayout>
      )
    }

    const actions: Array<{
      label: string
      onClick: () => void
    }> = []

    if (error.canRetry) {
      actions.push({
        label: 'Try Again',
        onClick: () => window.location.reload(),
      })
    }

    actions.push({
      label: 'Return to Home',
      onClick: () => router.push('/'),
    })

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

  if (accepted && !error) {
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
          },
        ]}
      />
    </InviteLayout>
  )
}
