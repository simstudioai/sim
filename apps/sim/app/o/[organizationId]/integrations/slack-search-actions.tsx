'use client'

import { Chip, ChipLink } from '@sim/emcn'
import { slackSearchOnboardingPath } from '@/lib/slack-search/onboarding'
import {
  useRetrySlackSearchOnboarding,
  useSlackSearchOnboarding,
} from '@/hooks/queries/slack-search-onboarding'

interface SlackSearchActionsProps {
  organizationId: string
  token: string
  userId: string
}

/** Slack adds only thread return and retry actions to the ordinary integrations page. */
export function SlackSearchActions({ organizationId, token, userId }: SlackSearchActionsProps) {
  const status = useSlackSearchOnboarding(token, userId)
  const retry = useRetrySlackSearchOnboarding(userId)
  if (status.isPending) return null
  if (status.isError)
    return (
      <p role='alert' className='text-[var(--text-error)] text-caption'>
        {status.error.message}
      </p>
    )
  const data = status.data
  if (!('organizationId' in data) || data.organizationId !== organizationId)
    return <ChipLink href={slackSearchOnboardingPath(token)}>Finish Slack setup</ChipLink>
  const retried = data.status === 'retried' || retry.isSuccess
  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {!retried &&
        (data.status === 'ready' ? (
          <Chip
            variant='primary'
            disabled={retry.isPending}
            onClick={() => retry.mutate({ token })}
          >
            {retry.isPending ? 'Queuing…' : 'Retry question in Slack'}
          </Chip>
        ) : (
          <Chip
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
            title='Check whether your sources have finished indexing'
          >
            {status.isFetching ? 'Checking…' : 'Check indexing'}
          </Chip>
        ))}
      <ChipLink
        variant={retried ? 'primary' : undefined}
        href={data.slackUrl}
        referrerPolicy='no-referrer'
      >
        Return to Slack
      </ChipLink>
      {retry.isError && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {retry.error.message}
        </p>
      )}
    </div>
  )
}
