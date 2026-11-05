import styles from '@/platform/app/(shell)/_components/chat/message/message.module.css'
import { MessageTime } from '@/platform/app/(shell)/_components/chat/message/message-time'
import type { PlatformTurn } from '@/platform/app/(shell)/_components/chat/model'
import { MessageAttachments } from '@/platform/app/(shell)/_components/composer/message-attachments'
import { CopyButton } from '@/platform/design-system/components/button/copy-button'

interface UserMessageProps {
  turn: Extract<PlatformTurn, { role: 'user' }>
}
export function UserMessage({ turn }: UserMessageProps) {
  return (
    <div className={styles.user}>
      <MessageAttachments items={turn.prompt.attachments} />
      {turn.prompt.text && (
        <p className={styles.bubble} data-type='T048'>
          {turn.prompt.text}
        </p>
      )}
      <div className={styles.userActions} data-type='T060'>
        {turn.sentAt !== undefined && <MessageTime sentAt={turn.sentAt} timeZone={turn.timeZone} />}
        <CopyButton label='Copy message' text={turn.prompt.text} />
      </div>
    </div>
  )
}
