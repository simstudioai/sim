'use client'

import { Fragment } from 'react'
import { Button } from '@sim/emcn/button'
import { FailureNotice } from '@sim/emcn/status'
import { Receipt } from '@/app/(product)/_components/chat/cards/assistant-review'
import styles from '@/app/(product)/_components/chat/cards/cards.module.css'
import type { TurnReceiptsProps } from '@/app/(product)/_components/chat/message/message-segments'
import { useTurnReceipts } from '@/platform/lib/data/chat-review'
import { useOrganization } from '@/platform/lib/data/organization'

/**
 * A turn's action history on live data: every receipt of the turn's stream, a page at a time, with
 * its own retry when the history cannot be read.
 */
export function LiveTurnReceipts({
  chatId,
  streamId,
  active,
  mountedTurnCount,
  candidateIds,
  pending,
}: TurnReceiptsProps) {
  const { organization } = useOrganization()
  const history = useTurnReceipts({
    organizationId: organization.id,
    chatId,
    streamId,
    active,
    mountedTurnCount,
    candidateIds,
    pendingIds: new Set(pending.map((item) => item.id)),
  })
  const { receipts, unavailable, recovery } = history
  // One list in turn order, as legacy's recovery read: receipts and waiting actions interleaved.
  const items = [
    ...receipts.map((receipt) => ({
      id: receipt.id,
      sequence: receipt.sequence,
      card: <Receipt receipt={receipt} />,
    })),
    ...pending,
  ].sort(
    (left, right) =>
      (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
  )
  if (
    !items.length &&
    !unavailable.length &&
    history.status !== 'error' &&
    !history.more &&
    (!recovery || recovery.loading)
  )
    return null
  return (
    <section className={styles.history} aria-label='Action history'>
      {items.map((item) => (
        <Fragment key={item.id}>{item.card}</Fragment>
      ))}
      {unavailable.map((item) => (
        <FailureNotice
          key={item.id}
          message='Could not load action history'
          retrying={item.retrying}
          onRetry={item.retry}
        />
      ))}
      {history.status === 'error' && (
        <FailureNotice
          message='Could not load action history'
          retrying={history.retrying}
          onRetry={history.retry}
        />
      )}
      {recovery && !recovery.loading && (
        <div className={styles.actions}>
          <p className={styles.quiet} data-type='T052' role='status'>
            Action details unavailable
          </p>
          {recovery.failed && (
            <Button
              variant='muted'
              size='compact'
              disabled={recovery.fetching}
              onClick={recovery.retry}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {history.more && (
        <div className={styles.actions}>
          <Button
            variant='muted'
            size='compact'
            disabled={history.loadingMore}
            onClick={history.loadMore}
          >
            More action history
          </Button>
        </div>
      )}
    </section>
  )
}
