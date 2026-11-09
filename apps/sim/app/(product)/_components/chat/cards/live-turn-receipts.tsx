'use client'

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
  pendingIds,
}: TurnReceiptsProps) {
  const { organization } = useOrganization()
  const history = useTurnReceipts({
    organizationId: organization.id,
    chatId,
    streamId,
    active,
    mountedTurnCount,
  })
  const receipts = history.receipts.filter((receipt) => !pendingIds.has(receipt.id))
  if (!receipts.length && history.status !== 'error' && !history.more) return null
  return (
    <section className={styles.history} aria-label='Action history'>
      {receipts.map((receipt) => (
        <Receipt key={receipt.id} receipt={receipt} />
      ))}
      {history.status === 'error' && (
        <FailureNotice
          message='Could not load action history'
          retrying={history.retrying}
          onRetry={history.retry}
        />
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
