'use client'

import { useRef } from 'react'
import { Button } from '@sim/emcn/button'
import { AssistantReview } from '@/app/(product)/_components/chat/cards/assistant-review'
import { LaneActivity } from '@/app/(product)/_components/chat/message/lane-activity'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import { MessageSegments } from '@/app/(product)/_components/chat/message/message-segments'
import { ResponseActions } from '@/app/(product)/_components/chat/message/response-actions'
import {
  ToolActivity,
  ToolInteraction,
} from '@/app/(product)/_components/chat/message/tool-activity'
import type { PlatformPart, PlatformTurn } from '@/app/(product)/_components/chat/model'
import {
  useChatHandlers,
  useChatInteractions,
} from '@/app/(product)/_components/session/chat-runtime'

type AssistantTurn = Extract<PlatformTurn, { role: 'assistant' }>

interface ResponseMessageProps {
  turn: AssistantTurn
}

function ResponsePart({ part }: { part: PlatformPart }) {
  switch (part.kind) {
    case 'prose':
      // Marks the prose that Find in chat searches.
      return (
        <div className={styles.findable} data-chat-find=''>
          {part.paragraphs ? (
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
          )}
        </div>
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

export function ResponseMessage({ turn }: ResponseMessageProps) {
  const { state, parts, copyText, failure, waiting, endsWithInteraction } = turn
  const settled = state === 'complete' || state === 'stopped'
  const { review } = useChatInteractions()
  const { retry } = useChatHandlers()
  const inReview = review?.turnId === turn.id && (review.actions.length > 0 || review.pending)
  const turnRef = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={turnRef}
      className={styles.answer}
      role={review ? 'group' : undefined}
      aria-label={review ? 'Conversation turn' : undefined}
      tabIndex={review ? -1 : undefined}
    >
      {parts.map((part) => (
        <ResponsePart key={part.id} part={part} />
      ))}
      <AssistantReview turnId={turn.id} turn={turnRef} />
      {waiting && (
        <p className={styles.status} data-type='T048' role='status'>
          {waiting}
        </p>
      )}
      {state === 'failed' && (
        <>
          {failure && <p data-type='T048'>{failure}</p>}
          {retry && (
            <div className={styles.retry}>
              <Button variant='muted' size='compact' icon='I055' onClick={() => retry(turn.id)}>
                Retry
              </Button>
            </div>
          )}
        </>
      )}
      {copyText && settled && !endsWithInteraction && !inReview && <ResponseActions turn={turn} />}
    </div>
  )
}
