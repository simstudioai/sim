'use client'

import { Fragment, type RefObject, useEffect, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { Input, TextArea } from '@sim/emcn/field/inputs'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
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

type FieldValue = Pick<AssistantReviewField, 'name' | 'label' | 'value' | 'prominent'>

/** A value past its bounded height scrolls in place, faded at the edge that has more. */
function ReviewValue({ field }: { field: FieldValue }) {
  const edges = useScrollEdges<HTMLElement>()
  return (
    <dd ref={edges} data-type={field.prominent ? 'T047' : 'T048'}>
      {field.value}
    </dd>
  )
}

function FieldValues({ fields }: { fields: readonly FieldValue[] }) {
  return (
    <dl className={styles.values}>
      {fields.map((field) => (
        <div key={field.name}>
          <dt data-type='T052'>{field.label}</dt>
          <ReviewValue field={field} />
        </div>
      ))}
    </dl>
  )
}

interface ActionPreviewProps {
  account: string
  fields: readonly AssistantReviewField[]
  /** Lists the details too, rather than behind their disclosure, as a receipt does. */
  full?: boolean
}

/**
 * Readable content first, as legacy's preview read: the account and the targets the action acts
 * on, its content, then the remaining parameters behind Details.
 */
function ActionPreview({ account, fields, full = false }: ActionPreviewProps) {
  const shown = fields.filter((field) => field.value !== '')
  const primary = shown.filter((field) => field.role === 'primary')
  const details = shown.filter((field) => field.role === 'detail')
  return (
    <>
      <FieldValues
        fields={[
          { name: 'account', label: 'Account', value: account, prominent: false },
          ...shown.filter((field) => field.role === 'target'),
        ]}
      />
      {primary.length > 0 && <FieldValues fields={primary} />}
      {details.length > 0 &&
        (full ? (
          <FieldValues fields={details} />
        ) : (
          <Disclosure label='Details' variant='activity'>
            <FieldValues fields={details} />
          </Disclosure>
        ))}
    </>
  )
}

interface ActionCardProps {
  action: AssistantReviewAction
  edits: Record<string, string> | undefined
  error: string | undefined
  disabled: boolean
  onEdit: (name: string, value: string) => void
  onDecide: (decision: Decision, source: HTMLButtonElement) => void
}

function ActionCard({ action, edits, error, disabled, onEdit, onDecide }: ActionCardProps) {
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
      {editing ? (
        <div className={styles.fields}>
          <FieldValues
            fields={[
              {
                name: 'account',
                label: 'Account',
                value: action.account?.name ?? 'Account unavailable',
                prominent: false,
              },
            ]}
          />
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
        <ActionPreview account={action.account?.name ?? 'Account unavailable'} fields={fields} />
      )}
      {action.account && inactive && (
        <p className={styles.quiet} data-type='T052'>
          {`${action.account.name} needs to be reconnected`}
        </p>
      )}
      {!action.account && (
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
          onClick={(event) => onDecide('allow', event.currentTarget)}
        >
          Allow
        </Button>
        <Button
          variant='muted'
          size='compact'
          disabled={disabled}
          onClick={(event) => onDecide('skip', event.currentTarget)}
        >
          Cancel
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
          <ActionPreview
            account={receipt.account ?? 'Account unavailable'}
            fields={receipt.fields}
            full
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

interface AssistantReviewProps {
  turnId: string
  /** Takes focus back when the button a decision was made from is gone once it settles. */
  turn: RefObject<HTMLElement | null>
}

/**
 * An assistant turn's review: what every reviewed action of the turn did, read a page at a time,
 * and on the turn holding them, the actions still waiting for the person to allow or cancel.
 */
export function AssistantReview({ turnId, turn }: AssistantReviewProps) {
  const { review } = useChatInteractions()
  const cards = useChatCards()
  const [edits, setEdits] = useState<Edits>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const focusOrigin = useRef<HTMLButtonElement | null>(null)
  const pending = review?.pending ?? false

  // Saving disables the decision buttons, which drops their focus. Once it settles, focus returns
  // to the button decided from, or to the turn when that button is gone, unless the person has
  // since moved focus elsewhere.
  useEffect(() => {
    const origin = focusOrigin.current
    if (!origin) return
    if (pending) {
      const cancelRestore = () => {
        focusOrigin.current = null
      }
      const handleFocus = (event: FocusEvent) => {
        if (event.target !== origin && event.target !== document.body) cancelRestore()
      }
      document.addEventListener('focusin', handleFocus, true)
      document.addEventListener('pointerdown', cancelRestore, true)
      return () => {
        document.removeEventListener('focusin', handleFocus, true)
        document.removeEventListener('pointerdown', cancelRestore, true)
      }
    }
    focusOrigin.current = null
    if (
      document.hasFocus() &&
      (document.activeElement === document.body || document.activeElement === origin)
    ) {
      const target = origin.isConnected && !origin.disabled ? origin : turn.current
      target?.focus({ preventScroll: true })
    }
  }, [pending, turn])

  if (!review) return null
  const { actions, status, more, retry, decide, streamIds } = review
  const ownsActions = review.turnId === turnId
  const streamId = streamIds.get(turnId)
  async function run(ids: readonly string[], decision: Decision, source: HTMLButtonElement) {
    focusOrigin.current = document.activeElement === source ? source : null
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id)))
    )
    const failures = await decide(ids, decision, decision === 'allow' ? edits : undefined)
    // The cards not decided stay on screen, with whatever was typed into them.
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !ids.includes(id) || id in failures)
      )
    )
    setErrors((current) => ({ ...current, ...failures }))
  }
  const reviewCards = ownsActions
    ? actions.map((action) => ({
        id: action.id,
        sequence: action.sequence,
        card: (
          <ActionCard
            action={action}
            edits={edits[action.id]}
            error={errors[action.id]}
            disabled={pending || status === 'error'}
            onEdit={(name, value) => {
              setErrors((current) => omit(current, [action.id]))
              setEdits((current) => ({
                ...current,
                [action.id]: { ...current[action.id], [name]: value },
              }))
            }}
            onDecide={(decision, source) => void run([action.id], decision, source)}
          />
        ),
      }))
    : []
  const history =
    streamId && review.chatId && cards?.TurnReceipts ? (
      <cards.TurnReceipts
        chatId={review.chatId}
        streamId={streamId}
        active={review.active && ownsActions}
        mountedTurnCount={streamIds.size}
        candidateIds={review.candidates.get(turnId) ?? []}
        pending={reviewCards}
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
      {actions.length > 0 && (!history || actions.length > 1 || pending || more) && (
        <section className={styles.review} aria-label='Actions to review'>
          {!history && reviewCards.map((item) => <Fragment key={item.id}>{item.card}</Fragment>)}
          {actions.length > 1 && (
            <div className={styles.actions} aria-busy={pending || undefined}>
              <Button
                variant='primary'
                size='compact'
                disabled={allowDisabled || status === 'error'}
                onClick={(event) =>
                  void run(
                    actions.map((action) => action.id),
                    'allow',
                    event.currentTarget
                  )
                }
              >
                {`Allow ${actions.length} shown`}
              </Button>
              <Button
                variant='muted'
                size='compact'
                disabled={pending || status === 'error'}
                onClick={(event) =>
                  void run(
                    actions.map((action) => action.id),
                    'skip',
                    event.currentTarget
                  )
                }
              >
                {`Cancel ${actions.length} shown`}
              </Button>
            </div>
          )}
          {!pending && more && (
            <p className={styles.quiet} data-type='T052'>
              More actions are waiting.
            </p>
          )}
        </section>
      )}
    </>
  )
}
