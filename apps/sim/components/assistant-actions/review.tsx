'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chip, ChipInput, ChipTextarea, cn } from '@sim/emcn'
import { ShieldCheck } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { AssistantActionsResponse } from '@/lib/api/contracts/assistant-actions'
import { ASSISTANT_REVIEW_FIELD_MAX_CHARS } from '@/lib/assistant-actions/limits'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/live-message-id'
import { InteractionCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { type ChatMessage, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { BrandIcon } from '@/blocks/brand-icon'
import {
  useAssistantActionReview,
  useDecideAssistantAction,
} from '@/hooks/queries/assistant-actions'
import { getToolMetadata } from '@/tools/metadata'

type ReviewAction = AssistantActionsResponse['actions'][number]
type ReviewEdits = Record<string, { proposalVersion: string; fields: Record<string, string> }>
type ReviewErrors = Record<string, { proposalVersion: string; message: string }>

interface ReviewDrafts {
  runId: string | null
  edits: ReviewEdits
  errors: ReviewErrors
}

interface ReviewContextValue {
  query: ReturnType<typeof useAssistantActionReview>
  actions: ReviewAction[]
  byId: ReadonlyMap<string, ReviewAction>
  assistantMessageId: string | null
  recoveryMessageId: string | null
  recoveryActions: ReviewAction[]
  hasApprovalRows: boolean
  drafts: ReviewDrafts
  submitting: boolean
  edit: (action: ReviewAction, name: string, value: string) => void
  submit: (actions: ReviewAction[], decision: 'allow' | 'skip') => Promise<void>
}

const reviewContext = createContext<ReviewContextValue | null>(null)
const reviewMessageContext = createContext<string | null>(null)
const EMPTY_ACTIONS: ReviewAction[] = []

interface AssistantActionReviewProviderProps {
  organizationId: string
  chatId?: string
  messages: ChatMessage[]
  active: boolean
  enabled: boolean
  children: ReactNode
}

export function AssistantActionReviewProvider({
  organizationId,
  chatId,
  messages,
  active,
  enabled,
  children,
}: AssistantActionReviewProviderProps) {
  const inFlight = useRef<AbortController | null>(null)
  const query = useAssistantActionReview(organizationId, chatId ?? '', active, enabled)
  const mutation = useDecideAssistantAction(organizationId, chatId ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [drafts, setDrafts] = useState<ReviewDrafts>({ runId: null, edits: {}, errors: {} })
  const actions = query.data?.actions ?? EMPTY_ACTIONS
  const runId = query.data?.runId ?? null
  const streamId = query.data?.streamId ?? null
  const byId = useMemo(
    () => new Map(actions.map((action) => [action.toolCallId, action])),
    [actions]
  )
  const { assistantMessageId, recoveryMessageId, recoveryActions, hasApprovalRows } =
    useMemo(() => {
      if (!streamId) {
        const hasApprovalRows = messages.some((message) =>
          message.contentBlocks?.some(
            ({ toolCall }) =>
              toolCall?.status === ToolCallStatus.awaiting_approval &&
              getToolMetadata(toolCall.name)?.assistant
          )
        )
        return {
          assistantMessageId: null,
          recoveryMessageId: hasApprovalRows ? null : (messages.at(-1)?.id ?? null),
          recoveryActions: EMPTY_ACTIONS,
          hasApprovalRows,
        }
      }
      const messageId = getLiveAssistantMessageId(streamId)
      const assistant = messages.find((message) => message.id === messageId)
      const representedIds = new Set(
        assistant?.contentBlocks?.flatMap(({ toolCall }) =>
          toolCall?.status === ToolCallStatus.awaiting_approval &&
          getToolMetadata(toolCall.name)?.assistant
            ? [toolCall.id]
            : []
        )
      )
      return {
        assistantMessageId: messageId,
        recoveryMessageId: assistant
          ? messageId
          : (messages.find((message) => message.role === 'user' && message.id === streamId)?.id ??
            null),
        recoveryActions: actions.filter((action) => !representedIds.has(action.toolCallId)),
        hasApprovalRows: representedIds.size > 0,
      }
    }, [actions, messages, streamId])

  useEffect(() => () => inFlight.current?.abort(), [runId])

  const edit = (action: ReviewAction, name: string, value: string) => {
    setDrafts((current) => {
      const edits = current.runId === action.runId ? current.edits : {}
      const draft = edits[action.toolCallId]
      return {
        runId: action.runId,
        errors: current.runId === action.runId ? omit(current.errors, [action.toolCallId]) : {},
        edits: {
          ...edits,
          [action.toolCallId]: {
            proposalVersion: action.proposalVersion,
            fields: {
              ...(draft?.proposalVersion === action.proposalVersion ? draft.fields : {}),
              [name]: value,
            },
          },
        },
      }
    })
  }
  const submit = async (selected: ReviewAction[], decision: 'allow' | 'skip') => {
    if (inFlight.current || query.isError || !selected.length) return
    const controller = new AbortController()
    inFlight.current = controller
    setSubmitting(true)
    const snapshot = selected.map((action) => {
      const draft = drafts.runId === action.runId ? drafts.edits[action.toolCallId] : undefined
      return {
        action,
        fields: draft?.proposalVersion === action.proposalVersion ? { ...draft.fields } : {},
      }
    })
    setDrafts((current) => ({
      runId,
      edits: current.runId === runId ? current.edits : {},
      errors:
        current.runId === runId
          ? omit(
              current.errors,
              selected.map((action) => action.toolCallId)
            )
          : {},
    }))
    try {
      for (const { action, fields } of snapshot) {
        if (controller.signal.aborted) break
        try {
          await mutation.mutateAsync({
            toolCallId: action.toolCallId,
            runId: action.runId,
            proposalVersion: action.proposalVersion,
            decision,
            signal: controller.signal,
            ...(decision === 'allow' ? { edits: fields } : {}),
          })
          setDrafts((current) =>
            current.runId === action.runId
              ? { ...current, edits: omit(current.edits, [action.toolCallId]) }
              : current
          )
        } catch (error) {
          if (controller.signal.aborted) break
          setDrafts((current) =>
            current.runId === action.runId
              ? {
                  ...current,
                  errors: {
                    ...current.errors,
                    [action.toolCallId]: {
                      proposalVersion: action.proposalVersion,
                      message: getErrorMessage(error, 'Could not save this review'),
                    },
                  },
                }
              : current
          )
        }
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null
        setSubmitting(false)
      }
    }
  }

  return (
    <reviewContext.Provider
      value={
        enabled
          ? {
              query,
              actions,
              byId,
              assistantMessageId,
              recoveryMessageId,
              recoveryActions,
              hasApprovalRows,
              drafts,
              submitting,
              edit,
              submit,
            }
          : null
      }
    >
      {children}
    </reviewContext.Provider>
  )
}

interface AssistantActionReviewMessageProps {
  messageId: string
  children: ReactNode
}

export function AssistantActionReviewMessage({
  messageId,
  children,
}: AssistantActionReviewMessageProps) {
  const review = useContext(reviewContext)
  return (
    <reviewMessageContext.Provider value={messageId}>
      {children}
      {review?.recoveryMessageId === messageId &&
        !review.hasApprovalRows &&
        review.recoveryActions.length === 0 &&
        review.query.isError && (
          <div className='pt-4'>
            <ReviewAvailability label='Could not load action review' review={review} />
          </div>
        )}
      {review?.recoveryMessageId === messageId && review.recoveryActions.length > 0 && (
        <div className='flex flex-col gap-3 pt-4'>
          {review.recoveryActions.map((action) => (
            <ActionReview
              key={`${action.toolCallId}:${action.proposalVersion}`}
              action={action}
              review={review}
            />
          ))}
        </div>
      )}
    </reviewMessageContext.Provider>
  )
}

interface AssistantActionReviewStatusProps {
  toolCallId: string
  title: string
  fallback: ReactNode
}

export function AssistantActionReviewStatus({
  toolCallId,
  title,
  fallback,
}: AssistantActionReviewStatusProps) {
  const review = useContext(reviewContext)
  const messageId = useContext(reviewMessageContext)
  if (!review) return fallback
  if (review.query.isPending) return <ReviewAvailability label='Loading action review' />
  if (messageId === review.assistantMessageId) {
    const action = review.byId.get(toolCallId)
    if (action) return <ActionReview key={action.proposalVersion} action={action} review={review} />
    if (!review.query.isError && review.query.data?.nextCursor != null)
      return <ReviewAvailability label='Review the current batch first' />
  }
  if (review.query.isError)
    return <ReviewAvailability label='Could not load action review' review={review} />
  return <ActivityStatus label={`${title} · No longer waiting for review`} isActive={false} />
}

interface ReviewAvailabilityProps {
  label: string
  review?: ReviewContextValue
}

function ReviewAvailability({ label, review }: ReviewAvailabilityProps) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <ActivityStatus label={label} isActive={false} icon={<ShieldCheck className='size-full' />} />
      {review && (
        <Chip disabled={review.query.isFetching} onClick={() => void review.query.refetch()}>
          Retry
        </Chip>
      )}
    </div>
  )
}

interface ActionReviewProps {
  action: ReviewAction
  review: ReviewContextValue
}

function ActionReview({ action, review }: ActionReviewProps) {
  const draft =
    review.drafts.runId === action.runId ? review.drafts.edits[action.toolCallId] : undefined
  const edits = draft?.proposalVersion === action.proposalVersion ? draft.fields : {}
  const error =
    review.drafts.runId === action.runId ? review.drafts.errors[action.toolCallId] : undefined
  const disabled = review.submitting || review.query.isError
  const display = action.account
    ? resolveCredentialDisplay({ ...action.account, type: 'managed_oauth' })
    : undefined
  const firstInBatch =
    review.actions.length > 1 && review.actions[0]?.toolCallId === action.toolCallId
  return (
    <section aria-label={`Review ${action.name}`} className='min-w-0'>
      <InteractionCard
        title={
          <span className='flex items-center gap-2'>
            {display?.icon ? (
              <BrandIcon icon={display.icon} className='size-[14px] shrink-0' />
            ) : (
              <ShieldCheck className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            )}
            {action.name}
          </span>
        }
      >
        <div className='flex flex-col gap-3 px-2 pb-2'>
          <p className='text-[var(--text-muted)] text-small'>
            {action.account?.displayName ?? 'Account unavailable'}
          </p>
          <div className='grid gap-3 sm:grid-cols-2'>
            {action.fields
              .filter((field) => field.value || field.editable)
              .map((field) => (
                <ActionReviewField
                  key={field.name}
                  field={field}
                  actionId={action.toolCallId}
                  value={edits[field.name] ?? field.value}
                  disabled={disabled}
                  onEdit={(value) => review.edit(action, field.name, value)}
                />
              ))}
          </div>
          {!action.account?.active && (
            <p className='text-[var(--text-muted)] text-small'>
              This account is no longer available.
            </p>
          )}
          {review.query.isError && (
            <ReviewAvailability label='Could not refresh action review' review={review} />
          )}
          {error?.proposalVersion === action.proposalVersion && (
            <p role='alert' className='text-[var(--text-error)] text-small'>
              {error.message}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            <Chip
              variant='primary'
              disabled={disabled || !action.account?.active}
              onClick={() => void review.submit([action], 'allow')}
            >
              Allow
            </Chip>
            <Chip disabled={disabled} onClick={() => void review.submit([action], 'skip')}>
              Cancel
            </Chip>
          </div>
          {firstInBatch && (
            <div className='flex flex-wrap items-center gap-2 border-[var(--border)] border-t pt-3'>
              <Chip
                disabled={disabled || review.actions.some((entry) => !entry.account?.active)}
                onClick={() => void review.submit(review.actions, 'allow')}
              >
                Allow {review.actions.length} shown
              </Chip>
              {review.query.data?.nextCursor != null && (
                <span className='text-[var(--text-muted)] text-small'>
                  More actions are waiting.
                </span>
              )}
            </div>
          )}
        </div>
      </InteractionCard>
    </section>
  )
}

interface ActionReviewFieldProps {
  field: ReviewAction['fields'][number]
  actionId: string
  value: string
  disabled: boolean
  onEdit: (value: string) => void
}

function ActionReviewField({ field, actionId, value, disabled, onEdit }: ActionReviewFieldProps) {
  const id = `assistant-action-${actionId}-${field.name}`
  return field.editable ? (
    <div className='col-span-full flex flex-col gap-1.5'>
      <label htmlFor={id} className='text-[var(--text-muted)] text-small'>
        {field.label}
      </label>
      {field.format === 'text' ? (
        <ChipInput
          id={id}
          value={value}
          disabled={disabled}
          maxLength={ASSISTANT_REVIEW_FIELD_MAX_CHARS}
          onChange={(event) => onEdit(event.target.value)}
        />
      ) : (
        <ChipTextarea
          id={id}
          value={value}
          disabled={disabled}
          rows={3}
          resizable
          maxLength={ASSISTANT_REVIEW_FIELD_MAX_CHARS}
          onChange={(event) => onEdit(event.target.value)}
        />
      )}
    </div>
  ) : (
    <dl className={cn('flex min-w-0 flex-col gap-1', field.format !== 'text' && 'col-span-full')}>
      <dt className='text-[var(--text-muted)] text-small'>{field.label}</dt>
      <dd className='whitespace-pre-wrap break-words text-[var(--text-body)] text-small'>
        {value}
      </dd>
    </dl>
  )
}
