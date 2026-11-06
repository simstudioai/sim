'use client'

import Link from 'next/link'
import { slackSearchOnboardingPath } from '@/lib/slack-search/onboarding'
import styles from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page.module.css'
import { Button } from '@/platform/design-system/components/button/button'
import { InlineNotice } from '@/platform/design-system/components/status/status'
import { useSlackSearchHandoff } from '@/platform/lib/data/slack-search-handoff'

interface SlackSearchActionsProps {
  organizationId: string
  token: string
  userId: string
}

/** Slack adds only thread return and retry actions to the ordinary integrations page. */
export function SlackSearchActions({ organizationId, token, userId }: SlackSearchActionsProps) {
  const handoff = useSlackSearchHandoff(organizationId, token, userId)
  if (handoff.stage === 'unread')
    return handoff.error ? <InlineNotice intent='danger' message={handoff.error} /> : null
  if (handoff.stage === 'elsewhere')
    return (
      <div className={styles.handoff}>
        <Button render={<Link href={slackSearchOnboardingPath(token)} />}>
          Finish Slack setup
        </Button>
      </div>
    )
  return (
    <div className={styles.handoff}>
      {!handoff.retried &&
        (handoff.ready ? (
          <Button variant='primary' disabled={handoff.retrying} onClick={handoff.retry}>
            {handoff.retrying ? 'Queuing' : 'Retry question in Slack'}
          </Button>
        ) : (
          <Button disabled={handoff.checking} onClick={handoff.check}>
            {handoff.checking ? 'Checking' : 'Check connection'}
          </Button>
        ))}
      <Button
        variant={handoff.retried ? 'primary' : 'secondary'}
        render={<Link href={handoff.slackUrl} referrerPolicy='no-referrer' />}
      >
        Return to Slack
      </Button>
      {handoff.retryError && <InlineNotice intent='danger' message={handoff.retryError} />}
      {handoff.checkError && <InlineNotice intent='danger' message={handoff.checkError} />}
    </div>
  )
}
