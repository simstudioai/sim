'use client'

import { AssistantReview } from '@/platform/app/(shell)/_components/chat/cards/assistant-review'
import { LaneActivity } from '@/platform/app/(shell)/_components/chat/message/lane-activity'
import styles from '@/platform/app/(shell)/_components/chat/message/message.module.css'
import { MessageSegments } from '@/platform/app/(shell)/_components/chat/message/message-segments'
import { ResponseActions } from '@/platform/app/(shell)/_components/chat/message/response-actions'
import {
  ToolActivity,
  ToolInteraction,
} from '@/platform/app/(shell)/_components/chat/message/tool-activity'
import type { PlatformPart, PlatformTurn } from '@/platform/app/(shell)/_components/chat/model'
import { useChatRuntime } from '@/platform/app/(shell)/_components/session/chat-runtime'
import { Button } from '@/platform/design-system/components'

type AssistantTurn = Extract<PlatformTurn, { role: 'assistant' }>

interface ResponseMessageProps {
  turn: AssistantTurn
  onRetry: () => void
}

function ResponsePart({ part }: { part: PlatformPart }) {
  switch (part.kind) {
    case 'prose':
      return part.paragraphs ? (
        part.paragraphs.map(({ lead, text }) => (
          <p key={text} data-type='T048'>
            {lead && (
              <>
                <strong>{lead}</strong>{' '}
              </>
            )}
            {text}
          </p>
        ))
      ) : (
        <MessageSegments segments={part.segments ?? []} />
      )
    case 'activity':
      return (
        <ToolActivity
          key={part.id}
          label={part.label}
          initiallyOpen={part.initiallyOpen}
          steps={part.tools}
          thinking={part.thinking}
          progress={part.progress}
        />
      )
    case 'approval':
      return <ToolInteraction tool={part.tool} />
    case 'lane':
      return <LaneActivity lane={part.lane} />
    case 'options':
      return <MessageSegments segments={[{ kind: 'options', options: part.options }]} />
    case 'task':
      return (
        <p className={styles.status} data-type='T048'>
          {part.title}
        </p>
      )
    case 'stopped':
      return (
        <p className={styles.status} data-type='T048'>
          Stopped by you
        </p>
      )
  }
}

export function ResponseMessage({ turn, onRetry }: ResponseMessageProps) {
  const { state, parts, copyText, sentAt, failure, waiting, endsWithInteraction } = turn
  const settled = state === 'complete' || state === 'stopped'
  const { review } = useChatRuntime()
  const inReview = review?.turnId === turn.id && (review.actions.length > 0 || review.pending)
  return (
    <div className={styles.answer}>
      {parts.map((part) => (
        <ResponsePart key={part.id} part={part} />
      ))}
      <AssistantReview turnId={turn.id} />
      {waiting && (
        <p className={styles.status} data-type='T048' role='status'>
          {waiting}
        </p>
      )}
      {state === 'failed' && (
        <>
          {failure && <p data-type='T048'>{failure}</p>}
          <div className={styles.retry}>
            <Button variant='muted' size='compact' icon='I055' onClick={onRetry}>
              Retry
            </Button>
          </div>
        </>
      )}
      {copyText && settled && !endsWithInteraction && !inReview && (
        <ResponseActions turn={turn} text={copyText} sentAt={sentAt} />
      )}
    </div>
  )
}
