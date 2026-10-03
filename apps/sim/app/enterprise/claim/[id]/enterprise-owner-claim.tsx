'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  acceptEnterpriseOwnerClaimContract,
  type EnterpriseOwnerClaimDetails,
} from '@/lib/api/contracts/enterprise-owner-claims'
import { client, useSession } from '@/lib/auth/auth-client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'
import { useEnterpriseOwnerClaimDetails } from '@/hooks/queries/enterprise-owner-claims'

interface EnterpriseOwnerClaimProps {
  registrationDisabled: boolean
}

function authLink(path: '/login' | '/signup', callbackUrl: string): string {
  return buildAuthCrossLink(path, { callbackUrl, isInviteFlow: true })
}

function apiErrorCode(error: unknown): string {
  if (!(error instanceof ApiClientError) || !error.body || typeof error.body !== 'object') {
    return 'server-error'
  }
  const code = (error.body as { error?: unknown }).error
  return typeof code === 'string' ? code : 'server-error'
}

function apiErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || !error.body || typeof error.body !== 'object') {
    return null
  }
  const message = (error.body as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

function claimSummary(details: EnterpriseOwnerClaimDetails) {
  const workspacePreview = details.workspacePreview
  const workspaces = workspacePreview?.workspacesToMove ?? []
  const workspaceCopy = workspacePreview?.createsDefaultWorkspace
    ? 'A new personal workspace will be created, then moved into the organization after Enterprise is active.'
    : workspaces.length > 0
      ? `${workspaces
          .slice(0, 3)
          .map((workspace) => workspace.name)
          .join(
            ', '
          )}${workspaces.length > 3 ? ` and ${workspaces.length - 3} more` : ''} will move into the organization after Enterprise is active.`
      : null
  return (
    <span className='block space-y-3 text-left'>
      <span className='block text-pretty text-center'>
        Accept to become the owner of <strong>{details.organizationName}</strong>. Billing starts
        only after you accept.
      </span>
      <span className='block rounded-lg border border-[var(--border-1)] p-4 text-sm tabular-nums'>
        <span className='flex justify-between gap-4'>
          <span>Invoice</span>
          <strong>
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
            }).format(details.invoiceAmountUsd)}{' '}
            / {details.billingInterval}
          </strong>
        </span>
        <span className='mt-2 flex justify-between gap-4'>
          <span>Seats</span>
          <strong>{details.seats.toLocaleString()}</strong>
        </span>
        {details.invitations > 0 && (
          <span className='mt-2 flex justify-between gap-4'>
            <span>People invited after activation</span>
            <strong>{details.invitations.toLocaleString()}</strong>
          </span>
        )}
      </span>
      {workspaceCopy && (
        <span className='block text-pretty text-center text-sm'>{workspaceCopy}</span>
      )}
      {details.acceptanceReview && !details.acceptanceReview.canAccept && (
        <span className='block text-pretty rounded-lg border border-[var(--border-1)] p-3 text-center text-sm'>
          {details.acceptanceReview.reason}
        </span>
      )}
    </span>
  )
}

export default function EnterpriseOwnerClaim({ registrationDisabled }: EnterpriseOwnerClaimProps) {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const claimId = params.id as string
  const storageKey = `enterpriseOwnerClaimToken:${claimId}`
  const tokenFromQuery = searchParams.get('token') || null
  const { data: session, isPending: sessionPending } = useSession()
  const [storedToken, setStoredToken] = useState<string | null | undefined>(undefined)
  const [accepting, setAccepting] = useState(false)
  const [acceptedClaim, setAcceptedClaim] = useState<EnterpriseOwnerClaimDetails['status']>()
  const [actionError, setActionError] = useState<{ code: string; message: string }>()
  const token = tokenFromQuery ?? storedToken ?? null
  const tokenResolved = tokenFromQuery !== null || storedToken !== undefined

  useEffect(() => {
    if (tokenFromQuery) {
      sessionStorage.setItem(storageKey, tokenFromQuery)
      setStoredToken(tokenFromQuery)
      window.history.replaceState(null, '', window.location.pathname)
      return
    }
    setStoredToken(sessionStorage.getItem(storageKey))
  }, [storageKey, tokenFromQuery])

  const detailsQuery = useEnterpriseOwnerClaimDetails(claimId, token, session?.user?.id ?? null, {
    enabled: Boolean(session?.user && tokenResolved),
  })
  const callbackUrl = `/enterprise/claim/${claimId}${token ? `?token=${encodeURIComponent(token)}` : ''}`

  if (!session?.user && !sessionPending) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='login'
          title="You're invited to own an Enterprise organization"
          description={
            registrationDisabled
              ? 'Sign in with the invited email to review the Enterprise setup.'
              : 'Create your Sim account with the invited email, then review and activate the Enterprise setup.'
          }
          icon='userPlus'
          actions={[
            ...(registrationDisabled
              ? []
              : [
                  {
                    label: 'Create an account',
                    onClick: () => router.push(authLink('/signup', callbackUrl)),
                  },
                ]),
            {
              label: 'I already have an account',
              onClick: () => router.push(authLink('/login', callbackUrl)),
            },
            { label: 'Return to Home', onClick: () => router.push('/') },
          ]}
        />
      </InviteLayout>
    )
  }

  if (sessionPending || (session?.user && (!tokenResolved || detailsQuery.isPending))) {
    return (
      <InviteLayout>
        <InviteStatusCard type='loading' title='' description='Loading Enterprise invitation...' />
      </InviteLayout>
    )
  }

  if (!token) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Invalid invitation'
          description='The owner invitation link is missing its secure token.'
          icon='error'
          actions={[{ label: 'Return to Home', onClick: () => router.push('/') }]}
        />
      </InviteLayout>
    )
  }

  const queryErrorCode = detailsQuery.error ? apiErrorCode(detailsQuery.error) : null
  const error =
    actionError ??
    (!acceptedClaim && queryErrorCode
      ? {
          code: queryErrorCode,
          message:
            apiErrorMessage(detailsQuery.error) ??
            (queryErrorCode === 'email-mismatch'
              ? 'This invitation was sent to a different email address.'
              : 'This Enterprise invitation is invalid or unavailable.'),
        }
      : null)
  if (error) {
    const wrongAccount = error.code === 'email-mismatch'
    return (
      <InviteLayout>
        <InviteStatusCard
          type={wrongAccount ? 'warning' : 'error'}
          title={wrongAccount ? 'Wrong account' : 'Enterprise invitation error'}
          description={error.message}
          icon={wrongAccount ? 'userPlus' : 'error'}
          actions={[
            ...(wrongAccount
              ? [
                  {
                    label: 'Sign in with a different account',
                    onClick: async () => {
                      await client.signOut()
                      router.push(authLink('/login', callbackUrl))
                    },
                  },
                ]
              : [{ label: 'Try again', onClick: () => window.location.reload() }]),
            { label: 'Return to Home', onClick: () => router.push('/') },
          ]}
        />
      </InviteLayout>
    )
  }

  const details = detailsQuery.data
  if (!details) return null
  if (details.status === 'expired') {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Invitation expired'
          description='Ask the Admin team to send a new Enterprise owner invitation.'
          icon='error'
          actions={[{ label: 'Return to Home', onClick: () => router.push('/') }]}
        />
      </InviteLayout>
    )
  }
  if (details.status === 'revoked') {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Invitation revoked'
          description='This Enterprise owner invitation is no longer active. Ask the Admin team to send a new invitation if needed.'
          icon='error'
          actions={[{ label: 'Return to Home', onClick: () => router.push('/') }]}
        />
      </InviteLayout>
    )
  }
  if (acceptedClaim || details.workspacePreview === null) {
    const applied = acceptedClaim === 'applied' || details.status === 'applied'
    return (
      <InviteLayout>
        <InviteStatusCard
          type={details.status === 'failed' ? 'error' : 'success'}
          title={applied ? 'Enterprise is active' : 'Enterprise activation started'}
          description={
            details.status === 'failed'
              ? details.error || 'Activation needs attention from the Admin team.'
              : applied
                ? 'Enterprise entitlement is applied. Sign in again to enter the organization.'
                : 'Stripe activation is in progress. Workspaces and teammate invitations remain locked until the verified entitlement is applied; you will be signed out when that happens.'
          }
          icon={details.status === 'failed' ? 'error' : 'success'}
          actions={
            applied
              ? [
                  {
                    label: 'Sign in to Enterprise',
                    onClick: async () => {
                      await client.signOut()
                      router.push(authLink('/login', APP_ENTRY_PATH))
                    },
                  },
                ]
              : [
                  {
                    label: 'Check status',
                    onClick: async () => {
                      const refreshed = await detailsQuery.refetch()
                      if (refreshed.data) setAcceptedClaim(refreshed.data.status)
                    },
                  },
                  { label: 'Return to Home', onClick: () => router.push('/') },
                ]
          }
        />
      </InviteLayout>
    )
  }

  const accept = async () => {
    setAccepting(true)
    setActionError(undefined)
    try {
      const response = await requestJson(acceptEnterpriseOwnerClaimContract, {
        params: { id: claimId },
        body: {
          token,
          disclosedWorkspaceIds:
            details.workspacePreview?.workspacesToMove.map((row) => row.id) ?? [],
          disclosedCreatesDefaultWorkspace:
            details.workspacePreview?.createsDefaultWorkspace ?? false,
        },
      })
      setAcceptedClaim(response.claim.status)
    } catch (acceptError) {
      const code = apiErrorCode(acceptError)
      const fallbackByCode: Record<string, string> = {
        'disclosure-outdated':
          'Your personal workspaces changed. Reload and review the updated list before accepting.',
        'already-in-organization':
          'This account already belongs to an organization and cannot become this organization owner.',
        'insufficient-seats': 'The selected plan no longer has enough seats for this setup.',
        'workspace-limit': 'This account has too many personal workspaces to migrate safely.',
        revoked: 'This Enterprise owner invitation has been revoked.',
        'workspace-invitation-limit':
          'The teammate invitation batch covers too many workspaces. Ask the Admin team to adjust the setup.',
      }
      setActionError({
        code,
        message:
          apiErrorMessage(acceptError) ??
          fallbackByCode[code] ??
          'Enterprise activation could not be started. Please try again.',
      })
      if (code === 'disclosure-outdated') await detailsQuery.refetch()
    } finally {
      setAccepting(false)
    }
  }

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title='Enterprise owner invitation'
        description={claimSummary(details)}
        icon='users'
        actions={[
          {
            label: 'Accept and activate',
            onClick: accept,
            disabled: accepting || details.acceptanceReview?.canAccept === false,
            loading: accepting,
          },
          { label: 'Not now', onClick: () => router.push('/') },
        ]}
      />
    </InviteLayout>
  )
}
