'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/chat/_components/message/message.module.css'
import { MessageTime } from '@/platform/app/(shell)/chat/_components/message/message-time'
import {
  ActionMenu,
  CopyButton,
  FieldFrame,
  SegmentedControl,
} from '@/platform/design-system/components'
import { TextArea } from '@/platform/design-system/components/field/inputs'
import { Modal } from '@/platform/design-system/components/modal/modal'

interface ResponseActionsProps {
  text: string
  sentAt: number
}
export function ResponseActions({ text, sentAt }: ResponseActionsProps) {
  const [feedback, setFeedback] = useState<'Good response' | 'Bad response' | null>(null)
  const [rating, setRating] = useState<'Good response' | 'Bad response' | null>(null)
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
        <MessageTime sentAt={sentAt} />
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
        onConfirm={() => {
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
                density='expanded'
              />
            </FieldFrame>
          </>
        )}
      </Modal>
    </>
  )
}
