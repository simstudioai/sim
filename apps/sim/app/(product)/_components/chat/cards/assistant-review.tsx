'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Input, TextArea } from '@sim/emcn/field/inputs'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { omit } from '@sim/utils/object'
import styles from '@/app/(product)/_components/chat/cards/cards.module.css'
import { useChatCards } from '@/app/(product)/_components/chat/message/message-segments'
import type {
  AssistantReceipt,
  AssistantReviewAction,
  AssistantReviewField,
} from '@/app/(product)/_components/chat/model'
import { useChatInteractions } from '@/app/(product)/_components/session/chat-runtime'

type Edits = Record<string, Record<string, string>>
type Decision = 'allow' | 'skip'

function FieldValues({ fields }: { fields: readonly AssistantReviewField[] }) {
  return (
    <dl className={styles.fields}>
      {fields.map((field) => (
        <div key={field.name}>
          <dt data-type='T052'>{field.label}</dt>
          <dd data-type='T048'>{field.value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface ActionCardProps {
  action: AssistantReviewAction
  edits: Record<string, string> | undefined
  error: string | undefined
  disabled: boolean
  saving: Decision | null
  onEdit: (name: string, value: string) => void
  onDecide: (decision: Decision) => void
}

function ActionCard({ action, edits, error, disabled, saving, onEdit, onDecide }: ActionCardProps) {
  const [editing, setEditing] = useState(false)
  const inactive = action.account?.active === false
  const fields = action.fields.map((field) => ({
    ...field,
    value: edits?.[field.name] ?? field.value,
  }))
  return (
    <section
      className={styles.card}
      aria-label={`Review ${action.title}`}
      aria-busy={disabled || undefined}
    >
      <div className={styles.row}>
        <span className={styles.title} data-type='T048'>
          {action.title}
        </span>
        {action.fields.some((field) => field.editable) && (
          <Button
            variant='muted'
            size='compact'
            disabled={disabled}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>
      <dl className={styles.fields}>
        <div>
          <dt data-type='T052'>Account</dt>
          <dd data-type='T048'>{action.account?.name ?? 'Account unavailable'}</dd>
        </div>
      </dl>
      {editing ? (
        <div className={styles.fields}>
          {fields.map((field) =>
            field.editable ? (
              field.multiline ? (
                <TextArea
                  key={field.name}
                  placeholder={field.label}
                  label={field.label}
                  value={field.value}
                  disabled={disabled}
                  onChange={(next) => onEdit(field.name, next)}
                />
              ) : (
                <Input
                  key={field.name}
                  placeholder={field.label}
                  label={field.label}
                  value={field.value}
                  disabled={disabled}
                  onChange={(next) => onEdit(field.name, next)}
                />
              )
            ) : (
              <FieldValues key={field.name} fields={[field]} />
            )
          )}
        </div>
      ) : (
        <FieldValues fields={fields} />
      )}
      {(inactive || !action.account) && (
        <p className={styles.quiet} data-type='T052'>
          This account is no longer available.
        </p>
      )}
      {error && <InlineNotice intent='danger' message={error} />}
      <div className={styles.actions}>
        <Button
          variant='primary'
          size='compact'
          disabled={disabled || inactive || !action.account}
          onClick={() => onDecide('allow')}
        >
          {saving === 'allow' ? 'Saving…' : 'Allow'}
        </Button>
        <Button variant='muted' size='compact' disabled={disabled} onClick={() => onDecide('skip')}>
          {saving === 'skip' ? 'Saving…' : 'Cancel'}
        </Button>
      </div>
    </section>
  )
}

const RECEIPT_INTENT: Record<string, 'danger' | 'warning' | 'success' | 'neutral'> = {
  failed: 'danger',
  uncertain: 'warning',
  succeeded: 'success',
}

/** What a reviewed action did; opening it shows the account and the exact fields it ran with. */
export function Receipt({ receipt }: { receipt: AssistantReceipt }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className={styles.card} aria-label={`${receipt.title} receipt`}>
      <div className={styles.row}>
        <span className={styles.title} data-type='T048'>
          {receipt.title}
        </span>
        <StatusTag label={receipt.stateLabel} intent={RECEIPT_INTENT[receipt.state] ?? 'neutral'} />
        <Button
          variant='quiet'
          size='compact'
          selected={expanded}
          aria-label={`${expanded ? 'Hide' : 'View'} ${receipt.title} receipt: ${receipt.stateLabel}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide' : 'View'}
        </Button>
      </div>
      {!expanded && receipt.summary && (
        <p className={styles.summary} data-type='T052'>
          {receipt.summary}
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
      {expanded &&
        (receipt.fields ? (
          <FieldValues
            fields={[
              {
                name: 'account',
                label: 'Account',
                value: receipt.account ?? 'Account unavailable',
                editable: false,
                multiline: false,
              },
              ...receipt.fields,
            ]}
          />
        ) : (
          <p className={styles.quiet} data-type='T052'>
            {receipt.account ?? 'Account unavailable'}. Details are no longer available for this
            action.
          </p>
        ))}
    </section>
  )
}

/**
 * An assistant turn's review: what every reviewed action of the turn did, read a page at a time,
 * and on the turn holding them, the actions still waiting for the person to allow or cancel.
 */
export function AssistantReview({ turnId }: { turnId: string }) {
  const { review } = useChatInteractions()
  const cards = useChatCards()
  const [edits, setEdits] = useState<Edits>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<{ ids: readonly string[]; decision: Decision } | null>(null)
  if (!review) return null
  const { actions, status, pending, more, retry, decide, streamIds } = review
  const ownsActions = review.turnId === turnId
  const streamId = streamIds.get(turnId)
  const pendingIds = new Set(actions.map((action) => action.id))
  async function run(ids: readonly string[], decision: Decision) {
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id)))
    )
    setSaving({ ids, decision })
    try {
      const failures = await decide(ids, decision, decision === 'allow' ? edits : undefined)
      // The cards not decided stay on screen, with whatever was typed into them.
      setEdits((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !ids.includes(id) || id in failures)
        )
      )
      setErrors((current) => ({ ...current, ...failures }))
    } finally {
      setSaving(null)
    }
  }
  const history =
    streamId && review.chatId && cards?.TurnReceipts ? (
      <cards.TurnReceipts
        chatId={review.chatId}
        streamId={streamId}
        active={review.active && ownsActions}
        mountedTurnCount={streamIds.size}
        candidateIds={[
          ...(review.candidates.get(turnId) ?? []),
          ...(ownsActions ? pendingIds : []),
        ]}
        pendingIds={ownsActions ? pendingIds : new Set()}
      />
    ) : null
  if (!ownsActions) return history
  const allowDisabled =
    pending || actions.some((action) => !action.account || action.account.active === false)
  return (
    <>
      {history}
      {status === 'error' && (
        <FailureNotice message='Could not load action review' onRetry={retry} />
      )}
      {actions.length > 0 && (
        <section className={styles.review} aria-label='Actions to review'>
          {actions.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              edits={edits[action.id]}
              error={errors[action.id]}
              disabled={pending || status === 'error'}
              saving={saving?.ids.includes(action.id) ? saving.decision : null}
              onEdit={(name, value) => {
                setErrors((current) => omit(current, [action.id]))
                setEdits((current) => ({
                  ...current,
                  [action.id]: { ...current[action.id], [name]: value },
                }))
              }}
              onDecide={(decision) => void run([action.id], decision)}
            />
          ))}
          {actions.length > 1 && (
            <div className={styles.actions} aria-busy={pending || undefined}>
              <Button
                variant='primary'
                size='compact'
                disabled={allowDisabled || status === 'error'}
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
                disabled={pending || status === 'error'}
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
          {pending ? (
            <p className={styles.quiet} data-type='T052' role='status'>
              Saving review
            </p>
          ) : (
            more && (
              <p className={styles.quiet} data-type='T052'>
                More actions are waiting.
              </p>
            )
          )}
        </section>
      )}
    </>
  )
}
