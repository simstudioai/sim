'use client'

import { useState } from 'react'
import {
  ActionMenu,
  Button,
  Disclosure,
  FieldFrame,
  IconButton,
  SegmentedControl,
  Tooltip,
} from '@/platform/design-system/components'
import { TextArea } from '@/platform/design-system/components/inputs'
import { Modal } from '@/platform/design-system/components/modal'
import styles from '@/platform/design-system/features/chat/chat.module.css'
import type { ChatTurn } from '@/platform/design-system/models/conversation'

interface CopyActionProps {
  label: string
  text: string
}
export function CopyAction({ label, text }: CopyActionProps) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip label={copied ? 'Copied' : label}>
      <IconButton
        label={label}
        icon={copied ? 'I072' : 'I006'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      />
    </Tooltip>
  )
}
interface ResponseTurnProps {
  response: NonNullable<ChatTurn['response']>
  onRetry: () => void
}
export function ResponseTurn({ response, onRetry }: ResponseTurnProps) {
  const [feedback, setFeedback] = useState<'Good response' | 'Bad response' | null>(null)
  const [rating, setRating] = useState<'Good response' | 'Bad response' | null>(null)
  const { state, paragraphs, steps } = response
  const running = state === 'running'
  const failed = state === 'failed'
  const label =
    state === 'complete'
      ? `Worked for ${response.duration}`
      : running
        ? 'Working for 12s'
        : failed
          ? 'Stopped after 8s'
          : 'Stopped'
  return (
    <div className={styles.answer}>
      <Disclosure key={state} label={label} variant='activity' initiallyOpen={running || failed}>
        <div className={styles.activity}>
          {!failed && (
            <p data-type='T060'>
              {running
                ? 'Comparing the request with account notes and checking for unresolved items.'
                : 'Compared the request with account notes and open items.'}
            </p>
          )}
          {(failed ? steps.slice(0, 1) : steps).map((step) => (
            <details key={step.id} className={styles.step}>
              <summary data-type='T060'>
                {step.name}
                <span data-type='T052'>{step.time}</span>
              </summary>
              <dl data-type='T052'>
                <dt>Input</dt>
                <dd>
                  <code>{step.input}</code>
                </dd>
                <dt>Response</dt>
                <dd>
                  <code>{step.output}</code>
                </dd>
              </dl>
            </details>
          ))}
        </div>
      </Disclosure>
      {failed && (
        <div className={styles.recovery}>
          <p data-type='T048'>
            The file is no longer available. Upload it again, or retry if access has been restored.
          </p>
          <Button variant='pill' size='compact' icon='I055' onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {paragraphs.map((text, index) => (
        <p key={text} data-type='T048'>
          {state === 'complete' &&
          index > 0 &&
          index < paragraphs.length - 1 &&
          text.includes('. ') ? (
            <>
              <strong>{text.slice(0, text.indexOf('. ') + 1)}</strong>
              {text.slice(text.indexOf('. ') + 1)}
            </>
          ) : (
            text
          )}
        </p>
      ))}
      {!failed && !running && (
        <div className={styles.responseActions}>
          <CopyAction label='Copy response' text={paragraphs.join('\n\n')} />
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
          <span data-type='T052'>{response.time}</span>
        </div>
      )}
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
    </div>
  )
}
