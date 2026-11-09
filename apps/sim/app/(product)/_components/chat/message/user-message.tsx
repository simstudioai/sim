import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { MessageBubble } from '@sim/emcn-platform/message-bubble'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import { MessageTime } from '@/app/(product)/_components/chat/message/message-time'
import { PageContext } from '@/app/(product)/_components/chat/message/page-context'
import type { PlatformTurn } from '@/app/(product)/_components/chat/model'
import { MessageAttachments } from '@/app/(product)/_components/composer/message-attachments'
import { useChatHandlers } from '@/app/(product)/_components/session/chat-runtime'

const DELIVERY_LABELS = {
  sending: 'Sending',
  waiting: 'Sends after this response',
  failed: 'Not delivered',
} as const

interface UserMessageProps {
  turn: Extract<PlatformTurn, { role: 'user' }>
}
export function UserMessage({ turn }: UserMessageProps) {
  const { retryMessage, dismissMessage } = useChatHandlers()
  const pages = turn.prompt.attachments.flatMap((item) =>
    item.context?.kind === 'browser_page' && item.context.snapshot
      ? [{ id: item.id, label: item.name, snapshot: item.context.snapshot }]
      : []
  )
  const attachments = pages.length
    ? turn.prompt.attachments.filter((item) => item.context?.kind !== 'browser_page')
    : turn.prompt.attachments
  return (
    <div className={styles.user}>
      {pages.map((page) => (
        <PageContext key={page.id} snapshot={page.snapshot} label={page.label} />
      ))}
      <MessageAttachments items={attachments} />
      {turn.prompt.text && (
        <MessageBubble>
          <span data-chat-find=''>{turn.prompt.text}</span>
        </MessageBubble>
      )}
      {turn.delivery && (
        <div className={styles.userActions} data-type='T060' role='status'>
          {DELIVERY_LABELS[turn.delivery]}
          {turn.delivery === 'failed' && retryMessage && (
            <Button variant='muted' size='compact' onClick={() => retryMessage(turn.id)}>
              Retry
            </Button>
          )}
          {turn.delivery === 'failed' && dismissMessage && (
            <Button variant='muted' size='compact' onClick={() => dismissMessage(turn.id)}>
              Dismiss
            </Button>
          )}
        </div>
      )}
      <div className={styles.userActions} data-type='T060'>
        {turn.sentAt !== undefined && <MessageTime sentAt={turn.sentAt} timeZone={turn.timeZone} />}
        <CopyButton label='Copy message' text={turn.prompt.text} />
      </div>
    </div>
  )
}
