import { MessageAttachments } from '@/platform/app/(shell)/_components/composer/message-attachments'
import type { ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import styles from '@/platform/app/(shell)/chat/_components/message/message.module.css'
import { CopyButton } from '@/platform/design-system/components/button/copy-button'

interface UserMessageProps {
  turn: ChatTurn
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
        <time data-type='T052'>{turn.time}</time>
        <CopyButton label='Copy message' text={turn.prompt.text} />
      </div>
    </div>
  )
}
