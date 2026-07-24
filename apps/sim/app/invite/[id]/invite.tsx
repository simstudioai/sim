'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatQuotedNameList } from '@sim/utils/string'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  acceptInvitationContract,
  type InvitationJoinPreview,
} from '@/lib/api/contracts/invitations'
import { client, useSession } from '@/lib/auth/auth-client'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'
import { useInvitationDetails } from '@/hooks/queries/invitations'
import { organizationKeys } from '@/hooks/queries/organization'
import { refreshSessionQuery } from '@/hooks/queries/session'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { workspaceKeys } from '@/hooks/queries/workspace'

const logger = createLogger('InviteById')

function runBestEffortCacheRefresh(cache: string, refresh: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(refresh)
    .catch((refreshError) => {
      logger.warn('Post-acceptance cache refresh failed', {
        cache,
        error: getErrorMessage(refreshError),
      })
    })
}

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
  | 'upgrade-required'
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
        'This organization has reached its seat limit. Ask an admin to contact support to add seats, then try again.',
      canRetry: true,
    },
    'upgrade-required': {
      code: 'upgrade-required',
      message:
        'The workspace owner needs an active paid plan with billing set up before you can join. Ask them to update their plan, then try again.',
      canRetry: true,
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

const MAX_LISTED_WORKSPACE_NAMES = 3

/**
 * Disclosure appended to the accept copy when accepting moves the invitee's
 * own workspaces into the organization — said where the decision happens, so
 * accepting never silently changes who controls their work.
 */
function buildWorkspaceMigrationNotice(
  joinPreview: InvitationJoinPreview | null,
  organizationLabel: string
): string {
  if (!joinPreview?.willJoinOrganization || joinPreview.workspacesToMove.length === 0) {
    return ''
  }

  const names = joinPreview.workspacesToMove
  const nameList = formatQuotedNameList(names, MAX_LISTED_WORKSPACE_NAMES)
  const single = names.length === 1

  return ` Accepting also moves your ${single ? 'workspace' : 'workspaces'} ${nameList} into ${organizationLabel}: its admins get full access, and ${single ? 'it stays' : 'they stay'} with the organization if you leave.`
}

function codeFromStatus(status: number): InviteErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'invalid-invitation'
  if (status === 409) return 'already-in-organization'
  if (status >= 500) return 'server-error'
  return 'unknown'
}

function codeFromApiClientError(error: ApiClientError): string {
  if (error.body && typeof error.body === 'object') {
    const code = (error.body as { error?: unknown }).error
    if (typeof code === 'string' && code.length > 0) return code
  }

  return codeFromStatus(error.status)
}

export default function Invite() {
  const router = useRouter()
  const params = useParams()
  const inviteId = params.id as string
  const inviteTokenStorageKey = `inviteToken:${inviteId}`
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<InviteError | null>(null)
  const [urlError, setUrlError] = useState<InviteError | null>(null)
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
      setUrlError(getInviteError(errorReason))
    }
  }, [searchParams, inviteId, inviteTokenStorageKey])

  const invitationQuery = useInvitationDetails(inviteId, token, {
    enabled: Boolean(session?.user),
  })
  const invitation = invitationQuery.data?.invitation ?? null
  const joinPreview = invitationQuery.data?.joinPreview ?? null
  const joinPreviewUnavailable = invitationQuery.data?.joinPreviewUnavailable === true
  const isLoading = Boolean(session?.user) && invitationQuery.isPending

  const fetchError = invitationQuery.error
    ? getInviteError(
        invitationQuery.error instanceof ApiClientError
          ? codeFromApiClientError(invitationQuery.error)
          : 'network-error'
      )
    : null
  /**
   * Action errors (accept failures) outrank fetch errors; the URL error param
   * only shows until the invitation loads successfully.
   */
  const error = actionError ?? fetchError ?? (invitationQuery.data ? null : urlError)

  const handleAcceptInvitation = async () => {
    if (!session?.user || !invitation) return
    setIsAccepting(true)

    try {
      const data = await requestJson(acceptInvitationContract, {
        params: { id: inviteId },
        body: { token: token ?? undefined },
      })

      setAccepted(true)
      setIsAccepting(false)
      setTimeout(() => router.push(data.redirectPath), 1200)

      runBestEffortCacheRefresh('session', () => refreshSessionQuery(queryClient))
      runBestEffortCacheRefresh('subscription', () =>
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
      )
      runBestEffortCacheRefresh('organization', () =>
        queryClient.invalidateQueries({ queryKey: organizationKeys.all })
      )
      /**
       * Acceptance can attach the invitee's owned workspaces into the org —
       * the workspace list must not keep serving the stale personal set.
       */
      runBestEffortCacheRefresh('workspaces', () =>
        queryClient.invalidateQueries({ queryKey: workspaceKeys.all })
      )
    } catch (acceptError) {
      logger.error('Error accepting invitation:', acceptError)
      const code =
        acceptError instanceof ApiClientError
          ? codeFromApiClientError(acceptError)
          : 'network-error'
      const serverMessage =
        acceptError instanceof ApiClientError &&
        acceptError.body &&
        typeof acceptError.body === 'object' &&
        typeof (acceptError.body as { message?: unknown }).message === 'string'
          ? ((acceptError.body as { message: string }).message as string)
          : null
      const baseError = getInviteError(code)
      setActionError(
        code === 'server-error' && serverMessage
          ? { ...baseError, message: serverMessage }
          : baseError
      )
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
  const organizationLabel = invitation?.organizationName || 'the organization'
  /**
   * When the server could not compute the preview, fall back to a generic
   * migration notice for membership invites — a missing preview must never
   * read as "nothing moves".
   */
  const migrationNotice =
    joinPreviewUnavailable && invitation?.membershipIntent !== 'external'
      ? ` If you own personal workspaces, accepting membership moves them into ${organizationLabel}: its admins get full access, and they stay with the organization if you leave.`
      : buildWorkspaceMigrationNotice(joinPreview, organizationLabel)

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title={isOrg ? 'Organization Invitation' : 'Workspace Invitation'}
        description={`You've been invited to join ${displayName}. Click accept below to join.${migrationNotice}`}
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
