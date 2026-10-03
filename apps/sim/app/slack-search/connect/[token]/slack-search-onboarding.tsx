'use client'

import { Chip, ChipLink } from '@sim/emcn'
import { redirect } from 'next/navigation'
import {
  slackSearchIntegrationsPath,
  slackSearchOnboardingPath,
} from '@/lib/slack-search/onboarding'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { useOAuthSwitchAccount } from '@/hooks/queries/oauth-provider'
import { useSlackSearchOnboarding } from '@/hooks/queries/slack-search-onboarding'

interface SlackSearchOnboardingProps {
  token: string
  userId: string
}

const ACCOUNT_STATUS_COPY = {
  wrong_account:
    'Sign out of Sim, then open this link again and sign in using the same email as your Slack account.',
  verify_email:
    'Verify your Sim email address, then return here. Search requires the same verified email as your Slack account.',
  membership_required:
    'Complete your organization’s existing invitation or SSO sign-in, then return here. If you haven’t been invited, ask your organization administrator for access.',
  identity_conflict:
    'Your Slack and Sim identities don’t match the organization’s account records. Ask your administrator to check the connection.',
} as const

export function SlackSearchOnboarding({ token, userId }: SlackSearchOnboardingProps) {
  const status = useSlackSearchOnboarding(token, userId)
  const switchAccount = useOAuthSwitchAccount()
  const callbackUrl = slackSearchOnboardingPath(token)
  const refresh = (
    <Chip disabled={status.isFetching} onClick={() => void status.refetch()}>
      {status.isFetching ? 'Checking…' : 'Check again'}
    </Chip>
  )
  if (status.isPending)
    return <p className='text-[var(--text-secondary)] text-sm'>Checking your connection…</p>
  if (status.isError)
    return (
      <div className='flex flex-col gap-4'>
        <h1 className='text-2xl'>Couldn’t open this question</h1>
        <p className='text-[var(--text-error)] text-sm'>{status.error.message}</p>
        {refresh}
      </div>
    )
  const data = status.data
  if (!('organizationId' in data))
    return (
      <div className='flex flex-col gap-4'>
        <h1 className='text-2xl'>Finish your Sim account setup</h1>
        <p className='text-[var(--text-secondary)] text-sm'>{ACCOUNT_STATUS_COPY[data.status]}</p>
        <div className='flex flex-wrap gap-2'>
          <Chip
            disabled={switchAccount.isPending}
            onClick={() =>
              switchAccount.mutate(undefined, {
                onSuccess: () =>
                  window.location.assign(
                    buildAuthCrossLink('/login', { callbackUrl, isInviteFlow: false })
                  ),
              })
            }
          >
            Sign in again
          </Chip>
          {data.status === 'membership_required' && (
            <ChipLink href={`/sso?${new URLSearchParams({ callbackUrl })}`}>
              Sign in with SSO
            </ChipLink>
          )}
          {refresh}
        </div>
        {switchAccount.isError && (
          <p className='text-[var(--text-error)] text-sm'>{switchAccount.error.message}</p>
        )}
      </div>
    )
  redirect(slackSearchIntegrationsPath(data.organizationId, token))
}
