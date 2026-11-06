'use client'

import Link from 'next/link'
import { slackSearchOnboardingPath } from '@/lib/slack-search/onboarding'
import styles from '@/app/o/[organizationId]/_redesign/integrations/slack-search-actions.module.css'
import {
  useRetrySlackSearchOnboarding,
  useSlackSearchOnboarding,
} from '@/hooks/queries/slack-search-onboarding'
import { Button, InlineNotice } from '@/platform/design-system/components'

interface SlackSearchActionsProps {
  organizationId: string
  token: string
  userId: string
}

/** Slack adds only thread return and retry actions to the ordinary integrations page. */
export function SlackSearchActions({ organizationId, token, userId }: SlackSearchActionsProps) {
  const status = useSlackSearchOnboarding(token, userId)
  const retry = useRetrySlackSearchOnboarding(userId)
  const data = status.data
  if (!data)
    return status.error ? <InlineNotice intent='danger' message={status.error.message} /> : null
  if (!('organizationId' in data) || data.organizationId !== organizationId)
    return (
      <div className={styles.actions}>
        <Button render={<Link href={slackSearchOnboardingPath(token)} />}>
          Finish Slack setup
        </Button>
      </div>
    )
  const retried = data.status === 'retried' || retry.isSuccess
  return (
    <div className={styles.actions}>
      {!retried &&
        (data.status === 'ready' ? (
          <Button
            variant='primary'
            disabled={retry.isPending}
            onClick={() => retry.mutate({ token })}
          >
            {retry.isPending ? 'Queuing' : 'Retry question in Slack'}
          </Button>
        ) : (
          <Button disabled={status.isFetching} onClick={() => void status.refetch()}>
            {status.isFetching ? 'Checking' : 'Check connection'}
          </Button>
        ))}
      <Button
        variant={retried ? 'primary' : 'secondary'}
        render={<Link href={data.slackUrl} referrerPolicy='no-referrer' />}
      >
        Return to Slack
      </Button>
      {retry.isError && <InlineNotice intent='danger' message={retry.error.message} />}
      {status.isRefetchError && <InlineNotice intent='danger' message={status.error.message} />}
    </div>
  )
}
