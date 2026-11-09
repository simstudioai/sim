'use client'

import { Button } from '@sim/emcn/button'
import { InlineNotice } from '@sim/emcn/status'
import Link from 'next/link'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/slack-search-actions/slack-search-actions.module.css'
import { useSlackSearchHandoff } from '@/platform/lib/data/integration-handoff'

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
        <Button render={<Link href={handoff.finishHref} />}>Finish Slack setup</Button>
      </div>
    )
  return (
    <div className={styles.handoff}>
      {!handoff.retried &&
        (handoff.ready ? (
          <Button variant='primary' disabled={handoff.retrying} onClick={handoff.retry}>
            Retry question in Slack
          </Button>
        ) : (
          <Button disabled={handoff.checking} onClick={handoff.check}>
            Check connection
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
