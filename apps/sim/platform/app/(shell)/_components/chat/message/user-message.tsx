import styles from '@/platform/app/(shell)/_components/chat/message/message.module.css'
import { MessageTime } from '@/platform/app/(shell)/_components/chat/message/message-time'
import type { PlatformTurn } from '@/platform/app/(shell)/_components/chat/model'
import { MessageAttachments } from '@/platform/app/(shell)/_components/composer/message-attachments'
import { useChatHandlers } from '@/platform/app/(shell)/_components/session/chat-runtime'
import { Button } from '@/platform/design-system/components'
import { CopyButton } from '@/platform/design-system/components/button/copy-button'

const DELIVERY_LABELS = {
  sending: 'Sending',
  waiting: 'Sends after this response',
  failed: 'Not delivered',
} as const

interface UserMessageProps {
  turn: Extract<PlatformTurn, { role: 'user' }>
}
export function UserMessage({ turn }: UserMessageProps) {
  const { retryMessage } = useChatHandlers()
  return (
    <div className={styles.user}>
      <MessageAttachments items={turn.prompt.attachments} />
      {turn.prompt.text && (
        <p className={styles.bubble} data-type='T048'>
          {turn.prompt.text}
        </p>
      )}
      {turn.delivery && (
        <div className={styles.userActions} data-type='T060' role='status'>
          {DELIVERY_LABELS[turn.delivery]}
          {turn.delivery === 'failed' && retryMessage && (
            <Button variant='muted' size='compact' onClick={() => retryMessage(turn.id)}>
              Retry
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
