'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Input, TextArea } from '@sim/emcn/field/inputs'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import styles from '@/platform/app/(shell)/_components/chat/cards/cards.module.css'
import type {
  AssistantReceipt,
  AssistantReviewAction,
} from '@/platform/app/(shell)/_components/chat/model'
import { useChatInteractions } from '@/platform/app/(shell)/_components/session/chat-runtime'

type Edits = Record<string, Record<string, string>>

function ActionCard({
  action,
  edits,
  onEdit,
  disabled,
  onDecide,
}: {
  action: AssistantReviewAction
  edits: Record<string, string> | undefined
  onEdit: (name: string, value: string) => void
  disabled: boolean
  onDecide: (decision: 'allow' | 'skip') => void
}) {
  const [editing, setEditing] = useState(false)
  const inactive = action.account?.active === false
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.title} data-type='T048'>
          {action.title}
        </span>
        {action.fields.some((field) => field.editable) && (
          <Button variant='muted' size='compact' onClick={() => setEditing((value) => !value)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>
      {action.account && (
        <p className={styles.quiet} data-type='T052'>
          {action.account.name}
          {inactive ? ' needs to be reconnected' : ''}
        </p>
      )}
      <dl className={styles.fields}>
        {action.fields.map((field) => {
          const value = edits?.[field.name] ?? field.value
          return (
            <div key={field.name}>
              <dt data-type='T052'>{field.label}</dt>
              <dd data-type='T048'>
                {editing && field.editable ? (
                  field.multiline ? (
                    <TextArea
                      placeholder={field.label}
                      label={field.label}
                      value={value}
                      onChange={(next) => onEdit(field.name, next)}
                    />
                  ) : (
                    <Input
                      placeholder={field.label}
                      label={field.label}
                      value={value}
                      onChange={(next) => onEdit(field.name, next)}
                    />
                  )
                ) : (
                  value
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <div className={styles.actions}>
        <Button
          variant='primary'
          size='compact'
          disabled={disabled || inactive}
          onClick={() => onDecide('allow')}
        >
          Allow
        </Button>
        <Button variant='muted' size='compact' disabled={disabled} onClick={() => onDecide('skip')}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Receipt({ receipt }: { receipt: AssistantReceipt }) {
  const intent =
    receipt.state === 'failed'
      ? 'danger'
      : receipt.state === 'uncertain'
        ? 'warning'
        : receipt.state === 'succeeded'
          ? 'success'
          : 'neutral'
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.title} data-type='T048'>
          {receipt.title}
        </span>
        <StatusTag label={receipt.stateLabel} intent={intent} />
      </div>
      {receipt.detail && (
        <p className={styles.quiet} data-type='T052'>
          {receipt.detail}
        </p>
      )}
      {receipt.state === 'uncertain' && (
        <p className={styles.quiet} data-type='T052'>
          Check the app before retrying.
        </p>
      )}
      {receipt.warning && (
        <p className={styles.quiet} data-type='T052'>
          {receipt.warning}
        </p>
      )}
    </div>
  )
}

/**
 * The actions an Assistant turn proposed, held until the person allows or cancels them. Rendered on
 * the turn they belong to; failure to load is shown rather than read as nothing to review.
 */
export function AssistantReview({ turnId }: { turnId: string }) {
  const { review } = useChatInteractions()
  const [edits, setEdits] = useState<Edits>({})
  const [failure, setFailure] = useState('')
  if (!review || review.turnId !== turnId) return null
  const { actions, receipts, status, pending, retry, decide } = review
  async function run(ids: readonly string[], decision: 'allow' | 'skip') {
    setFailure('')
    try {
      await decide(ids, decision, decision === 'allow' ? edits : undefined)
      // The cards not decided stay on screen, with whatever was typed into them.
      setEdits((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id)))
      )
    } catch (error) {
      setFailure(getErrorMessage(error, 'Could not save this review'))
    }
  }
  if (status === 'error')
    return <FailureNotice message='Could not load action review' onRetry={retry} />
  if (!actions.length && !receipts.length) return null
  const allowDisabled = pending || actions.some((action) => action.account?.active === false)
  return (
    <section className={styles.review} aria-label='Actions to review'>
      {receipts.map((receipt) => (
        <Receipt key={receipt.id} receipt={receipt} />
      ))}
      {actions.map((action) => (
        <ActionCard
          key={action.id}
          action={action}
          edits={edits[action.id]}
          disabled={pending}
          onEdit={(name, value) =>
            setEdits((current) => ({
              ...current,
              [action.id]: { ...current[action.id], [name]: value },
            }))
          }
          onDecide={(decision) => void run([action.id], decision)}
        />
      ))}
      {actions.length > 1 && (
        <div className={styles.actions}>
          <Button
            variant='primary'
            size='compact'
            disabled={allowDisabled}
            onClick={() =>
              void run(
                actions.map((action) => action.id),
                'allow'
              )
            }
          >
            {`Allow ${actions.length} shown`}
          </Button>
          <Button
            variant='muted'
            size='compact'
            disabled={pending}
            onClick={() =>
              void run(
                actions.map((action) => action.id),
                'skip'
              )
            }
          >
            {`Cancel ${actions.length} shown`}
          </Button>
        </div>
      )}
      {failure && <InlineNotice intent='danger' message={failure} />}
    </section>
  )
}
