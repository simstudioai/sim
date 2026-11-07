'use client'

import { useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { FieldFrame } from '@sim/emcn/field'
import { TextArea } from '@sim/emcn/field/inputs'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import styles from '@/platform/app/(shell)/_components/chat/message/message.module.css'
import { MessageTime } from '@/platform/app/(shell)/_components/chat/message/message-time'
import type { PlatformTurn } from '@/platform/app/(shell)/_components/chat/model'
import { useChatHandlers } from '@/platform/app/(shell)/_components/session/chat-runtime'

type Rating = 'Good response' | 'Bad response'

interface ResponseActionsProps {
  turn: Extract<PlatformTurn, { role: 'assistant' }>
}

export function ResponseActions({ turn }: ResponseActionsProps) {
  const { copyText: text, sentAt } = turn
  const { rate, fork } = useChatHandlers()
  const [feedback, setFeedback] = useState<Rating | null>(null)
  const [rating, setRating] = useState<Rating | null>(null)
  return (
    <>
      <div className={styles.responseActions} data-type='T060'>
        <CopyButton label='Copy response' text={text} />
        <ActionMenu
          icon={rating ? (rating === 'Good response' ? 'I017' : 'I008') : 'I069'}
          label='Rate response'
          actions={(['Good response', 'Bad response'] as const).map((label, i) => ({
            id: label,
            label,
            icon: i ? 'I008' : 'I017',
            onSelect: () => setFeedback(label),
          }))}
        />
        {fork && turn.forkable && (
          <IconButton
            tooltip
            label='Fork in new chat'
            icon='I118'
            onClick={() => void fork(turn.id)}
          />
        )}
        {sentAt !== undefined && <MessageTime sentAt={sentAt} />}
      </div>
      <Modal
        variant='feedback'
        open={feedback !== null}
        onOpenChange={(open) => {
          if (!open) setFeedback(null)
        }}
        title='Share feedback'
        description='What could Sim have done better?'
        confirmLabel='Send feedback'
        onConfirm={async (values) => {
          const written = String(values.get('details') ?? '').trim()
          // An empty details field sends nothing, as the rating alone means little to read.
          if (rate && written && turn.userQuery && feedback) {
            await rate({
              query: turn.userQuery,
              response: text,
              positive: feedback === 'Good response',
              details: written,
            })
          }
          setRating(feedback)
          setFeedback(null)
        }}
      >
        {feedback && (
          <>
            <FieldFrame label='Response quality'>
              <SegmentedControl
                label='Response quality'
                defaultValue={feedback}
                options={[
                  { value: 'Good response', label: 'Good response', icon: 'I017' },
                  { value: 'Bad response', label: 'Bad response', icon: 'I008' },
                ]}
                onSelect={(value) =>
                  setFeedback(value === 'Good response' ? 'Good response' : 'Bad response')
                }
              />
            </FieldFrame>
            <FieldFrame label='Details' optional>
              <TextArea
                label='Details'
                placeholder='Tell us what was missing or how the response could improve.'
                defaultSize='expanded'
                name='details'
              />
            </FieldFrame>
            {turn.requestId && <CopyField label='Request ID' value={turn.requestId} />}
          </>
        )}
      </Modal>
    </>
  )
}
