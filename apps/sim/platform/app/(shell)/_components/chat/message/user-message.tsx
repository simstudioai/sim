import { CopyButton } from '@sim/emcn/button/copy-button'
import { MessageBubble } from '@sim/emcn-platform/message-bubble'
import styles from '@/platform/app/(shell)/_components/chat/message/message.module.css'
import { MessageTime } from '@/platform/app/(shell)/_components/chat/message/message-time'
import type { PlatformTurn } from '@/platform/app/(shell)/_components/chat/model'
import { MessageAttachments } from '@/platform/app/(shell)/_components/composer/message-attachments'

interface UserMessageProps {
  turn: Extract<PlatformTurn, { role: 'user' }>
}
export function UserMessage({ turn }: UserMessageProps) {
  return (
    <div className={styles.user}>
      <MessageAttachments items={turn.prompt.attachments} />
      {turn.prompt.text && <MessageBubble>{turn.prompt.text}</MessageBubble>}
      <div className={styles.userActions} data-type='T060'>
        {turn.sentAt !== undefined && <MessageTime sentAt={turn.sentAt} timeZone={turn.timeZone} />}
        <CopyButton label='Copy message' text={turn.prompt.text} />
      </div>
    </div>
  )
}
