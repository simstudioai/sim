import { Button, IconButton } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/_components/chat/conversation/conversation.module.css'
import type { ChatRuntime } from '@/platform/app/(shell)/_components/chat/model'

/** Messages waiting behind the running turn. Each can go now, come back to edit, or be dropped. */
export function QueuedMessages({ runtime }: { runtime: ChatRuntime }) {
  const { queue, editingQueuedId, dispatchingQueuedId } = runtime
  if (!queue.length) return null
  return (
    <section className={styles.queue} aria-label='Queued messages'>
      {queue.map((message) => {
        const editing = editingQueuedId === message.id
        const dispatching = dispatchingQueuedId === message.id
        return (
          <div key={message.id} className={styles.queued}>
            <span className={styles.queuedText} data-type='T048'>
              {message.text || `${message.attachmentCount} attachments`}
            </span>
            {message.needsReview && (
              <span data-type='T052'>Review this message before sending</span>
            )}
            {editing ? (
              <Button variant='muted' size='compact' onClick={runtime.cancelQueueEdit}>
                Cancel edit
              </Button>
            ) : (
              <span className={styles.queuedActions}>
                <IconButton
                  tooltip
                  label='Send now'
                  icon='I023'
                  disabled={dispatching}
                  onClick={() => runtime.sendQueuedNow(message.id)}
                />
                {!message.locked && (
                  <IconButton
                    tooltip
                    label='Edit queued message'
                    icon='I118'
                    disabled={dispatching}
                    onClick={() => runtime.editQueued(message.id)}
                  />
                )}
                <IconButton
                  tooltip
                  label='Remove queued message'
                  icon='I105'
                  disabled={dispatching}
                  onClick={() => runtime.removeQueued(message.id)}
                />
              </span>
            )}
          </div>
        )
      })}
    </section>
  )
}
