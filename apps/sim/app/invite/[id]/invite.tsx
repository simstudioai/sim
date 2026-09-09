'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatQuotedNameList } from '@sim/utils/string'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { acceptInvitationContract } from '@/lib/api/contracts/invitations'
import { client, useSession } from '@/lib/auth/auth-client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { InvitationDisclosure, InviteLayout, InviteStatusCard } from '@/app/invite/components'
import { useInvitationDetails } from '@/hooks/queries/invitations'
import { organizationKeys } from '@/hooks/queries/organization'
import { refreshSessionQuery } from '@/hooks/queries/session'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { clearUserData } from '@/stores'

const logger = createLogger('InviteById')

/** Workspace names listed in the invitation title before collapsing into an "and N more" tail. */
const MAX_LISTED_WORKSPACE_NAMES = 3

/** A document navigation, so the marketing surface initializes its own theme store. */
function returnHome(): void {
  window.location.href = '/'
}

/**
 * Goes through the shared builder so the invite page cannot drift from the
 * cross-link shape the auth pages use.
 */
function inviteAuthLink(
  path: '/login' | '/signup',
  callbackUrl: string,
  isNewUser = false
): string {
  return buildAuthCrossLink(path, { callbackUrl, isInviteFlow: true, isNewUser })
}

interface InviteAction {
  label: string
  onClick: () => void
}

interface SignedOutPromptParams {
  registrationDisabled: boolean
  isNewUser: boolean
  callbackUrl: string
  navigate: (href: string) => void
}

/**
 * What a signed-out visitor is offered, as one branch so the copy and the
 * buttons under it can never disagree about what they may do.
 *
 * Under DISABLE_REGISTRATION only signing in is possible — `/signup` rejects
 * the visitor server-side, so offering it would be a dead end.
 */
function signedOutPrompt({
  registrationDisabled,
  isNewUser,
  callbackUrl,
  navigate,
}: SignedOutPromptParams): { description: string; actions: InviteAction[] } {
  const signIn: InviteAction = {
    label: 'Sign in',
    onClick: () => navigate(inviteAuthLink('/login', callbackUrl)),
  }

  if (registrationDisabled) {
    return {
      description: 'Account creation is disabled on this instance',
      actions: [signIn],
    }
  }

  if (isNewUser) {
    return {
      description: 'Create an account to join this workspace on Sim',
      actions: [
        {
          label: 'Create an account',
          onClick: () => navigate(inviteAuthLink('/signup', callbackUrl)),
        },
        { ...signIn, label: 'I already have an account' },
      ],
    }
  }

  return {
    description: 'Sign in to your account to accept this invitation',
    actions: [
      signIn,
      {
        label: 'Create an account',
        onClick: () => navigate(inviteAuthLink('/signup', callbackUrl, true)),
      },
    ],
  }
}

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
  | 'disclosure-outdated'
  | 'user-not-found'
  | 'already-member'
  | 'already-in-organization'
  | 'no-seats-available'
  | 'upgrade-required'
  | 'external-requires-paid-plan'
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
    'disclosure-outdated': {
      code: 'disclosure-outdated',
      message:
        'Your workspaces changed since this page loaded. Review the updated notice and accept again.',
      canRetry: true,
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
    'external-requires-paid-plan': {
      code: 'external-requires-paid-plan',
      message:
        'External collaborators need their own paid Sim plan. Upgrade your plan, or ask the organization to re-invite you as a member — that uses one of their seats instead.',
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

interface InviteProps {
  /** DISABLE_REGISTRATION. See {@link signedOutPrompt}. */
  registrationDisabled: boolean
}

export default function Invite({ registrationDisabled }: InviteProps) {
  const router = useRouter()
  const params = useParams()
  const inviteId = params.id as string
  const inviteTokenStorageKey = `inviteToken:${inviteId}`
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<InviteError | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  /** `undefined` until the effect reads storage; `null` once read and empty. */
  const [storedToken, setStoredToken] = useState<string | null | undefined>(undefined)

  const isNewUser = searchParams.get('new') === 'true'
  const errorReason = searchParams.get('error')
  const urlError = errorReason ? getInviteError(errorReason) : null
  /** `|| null` so an empty `?token=` falls back to storage rather than querying with ''. */
  const tokenFromQuery = searchParams.get('token') || null
  /**
   * Derived during render so the invitation query key is correct on the first
   * commit; an effect-set token refetches under a second key whenever the
   * session cache is already warm at mount.
   */
  const token = tokenFromQuery ?? storedToken ?? null
  const isTokenResolved = tokenFromQuery !== null || storedToken !== undefined

  useEffect(() => {
    if (tokenFromQuery) {
      sessionStorage.setItem(inviteTokenStorageKey, tokenFromQuery)
      return
    }
    setStoredToken(sessionStorage.getItem(inviteTokenStorageKey))
  }, [tokenFromQuery, inviteTokenStorageKey])

  const invitationQuery = useInvitationDetails(inviteId, token, session?.user?.id ?? null, {
    enabled: Boolean(session?.user) && isTokenResolved,
  })
  const invitation = invitationQuery.data?.invitation ?? null
  const joinPreview = invitationQuery.data?.joinPreview ?? null
  const isDisclosureMissing = invitation?.membershipIntent === 'internal' && !joinPreview
  const isLoading = Boolean(session?.user) && (!isTokenResolved || invitationQuery.isPending)

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
    if (!session?.user || !invitation || isDisclosureMissing || isAccepting) return
    setIsAccepting(true)

    try {
      const data = await requestJson(acceptInvitationContract, {
        params: { id: inviteId },
        body: {
          token: token ?? undefined,
          /**
           * Disclosure token: acceptance rejects with disclosure-outdated if
           * the sweep set no longer matches what this screen showed. Sent
           * whenever a preview rendered — a no-join preview means the user
           * was shown that nothing moves (an empty disclosed set), which
           * must also conflict if acceptance would sweep anything.
           */
          disclosedWorkspaceIds: joinPreview ? joinPreview.workspaceIdsToMove : undefined,
          disclosedOutcome: joinPreview?.outcome,
        },
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
    const prompt = signedOutPrompt({
      registrationDisabled,
      isNewUser,
      callbackUrl: getCallbackUrl(),
      navigate: router.push,
    })

    return (
      <InviteLayout>
        <InviteStatusCard
          type='login'
          title="You've been invited!"
          description={prompt.description}
          icon='userPlus'
          actions={[...prompt.actions, { label: 'Return to Home', onClick: returnHome }]}
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
    const callbackUrl = getCallbackUrl()

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
                  const loginUrl = inviteAuthLink('/login', callbackUrl)
                  let canNavigateInApp = false
                  try {
                    const [, inMemoryResetSucceeded] = await Promise.all([
                      client.signOut(),
                      clearUserData(),
                    ])
                    canNavigateInApp = inMemoryResetSucceeded
                  } catch (error) {
                    logger.error('Error signing out:', { error })
                  }
                  if (canNavigateInApp) router.push(loginUrl)
                  else window.location.assign(loginUrl)
                },
              },
              { label: 'Return to Home', onClick: returnHome },
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
              { label: 'Manage Team Settings', onClick: () => router.push(APP_ENTRY_PATH) },
              { label: 'Return to Home', onClick: returnHome },
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
                onClick: () => router.push(inviteAuthLink('/login', callbackUrl)),
              },
              ...(registrationDisabled
                ? []
                : [
                    {
                      label: 'Create an account',
                      onClick: () => router.push(inviteAuthLink('/signup', callbackUrl)),
                    },
                  ]),
              { label: 'Return to Home', onClick: returnHome },
            ]}
          />
        </InviteLayout>
      )
    }

    const actions: Array<{ label: string; onClick: () => void }> = []
    if (error.canRetry) {
      actions.push({ label: 'Try Again', onClick: () => window.location.reload() })
    }
    actions.push({ label: 'Return to Home', onClick: returnHome })

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

  /**
   * Names every granted workspace, not just the primary one — an invitation can
   * span several, and the email already lists them all.
   */
  const grantedWorkspaceNames =
    invitation?.grants
      .map((grant) => grant.workspaceName)
      .filter((name): name is string => Boolean(name)) ?? []
  const displayName =
    invitation?.kind === 'workspace'
      ? grantedWorkspaceNames.length > 0
        ? formatQuotedNameList(grantedWorkspaceNames, MAX_LISTED_WORKSPACE_NAMES)
        : 'a workspace'
      : invitation?.organizationName || 'an organization'

  if (accepted) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title='Welcome!'
          description={`You have successfully joined ${displayName}. Redirecting...`}
          icon='success'
          actions={[{ label: 'Return to Home', onClick: returnHome }]}
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
        description={`You've been invited to join ${displayName}.`}
        details={
          invitation && <InvitationDisclosure invitation={invitation} joinPreview={joinPreview} />
        }
        icon={isOrg ? 'users' : 'mail'}
        actions={[
          {
            label: 'Accept Invitation',
            onClick: handleAcceptInvitation,
            disabled: isAccepting || isDisclosureMissing,
            loading: isAccepting,
          },
          ...(isDisclosureMissing
            ? [
                {
                  label: 'Refresh invitation',
                  onClick: () => void invitationQuery.refetch(),
                  disabled: invitationQuery.isFetching,
                },
              ]
            : []),
          { label: 'Return to Home', onClick: returnHome },
        ]}
      />
    </InviteLayout>
  )
}
