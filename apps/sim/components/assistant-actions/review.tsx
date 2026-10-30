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
import { ActionPreview } from '@/components/assistant-actions/action-preview'
import { AssistantActionReceipt } from '@/components/assistant-actions/action-receipt'
import {
  assistantActionFieldPresentation,
  assistantActionPresentation,
} from '@/components/assistant-actions/presentation'
import { ActivityStatus } from '@/components/ui/activity-status'
import type {
  AssistantActionReceiptsResponse,
  AssistantActionsResponse,
} from '@/lib/api/contracts/assistant-actions'
import { ASSISTANT_REVIEW_FIELD_MAX_CHARS } from '@/lib/assistant-actions/limits'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/live-message-id'
import { InteractionCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { type ChatMessage, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { BrandIcon } from '@/blocks/brand-icon'
import {
  useAssistantActionReceiptBatches,
  useAssistantActionReview,
  useAssistantActionTurnReceipts,
  useDecideAssistantAction,
  useRefreshAssistantActionReceipts,
} from '@/hooks/queries/assistant-actions'
import { getToolMetadata } from '@/tools/metadata'

type ReviewAction = AssistantActionsResponse['actions'][number]
type Receipt = AssistantActionReceiptsResponse['receipts'][number]
type ReceiptBatchQuery = ReturnType<typeof useAssistantActionReceiptBatches>[number]['query']
type ReviewEdits = Record<string, { proposalVersion: string; fields: Record<string, string> }>
type ReviewErrors = Record<string, { proposalVersion: string; message: string }>

interface ReviewDrafts {
  runId: string | null
  edits: ReviewEdits
  errors: ReviewErrors
}

interface ReviewTurn {
  messageId: string
  representedIds: Set<string>
  hasApprovalRows: boolean
  writeIds: Set<string>
}

interface ReviewContextValue {
  organizationId: string
  chatId: string
  active: boolean
  streamId: string | null
  messageStreams: ReadonlyMap<string, string>
  messageReceiptIds: ReadonlyMap<string, ReadonlySet<string>>
  turns: ReadonlyMap<string, ReviewTurn>
  query: ReturnType<typeof useAssistantActionReview>
  actions: ReviewAction[]
  byId: ReadonlyMap<string, ReviewAction>
  recoveryMessageId: string | null
  recoveryActions: ReviewAction[]
  hasApprovalRows: boolean
  drafts: ReviewDrafts
  submitting: boolean
  pendingDecision?: { toolCallId: string; decision: 'allow' | 'skip' }
  edit: (action: ReviewAction, name: string, value: string) => void
  submit: (
    actions: ReviewAction[],
    decision: 'allow' | 'skip',
    onStart: () => void
  ) => Promise<void>
}

interface ReviewMessageContextValue {
  messageId: string
  streamId?: string
  receipts: ReadonlyMap<string, AssistantActionReceiptsResponse['receipts'][number]>
  receiptQuery: ReturnType<typeof useAssistantActionTurnReceipts>
  receiptQueries: ReadonlyMap<string, ReceiptBatchQuery>
  layout: { standaloneToolIds: ReadonlySet<string>; reviewedToolIds: ReadonlySet<string> }
  submit: (actions: ReviewAction[], decision: 'allow' | 'skip', source: HTMLButtonElement) => void
}

const reviewContext = createContext<ReviewContextValue | null>(null)
const reviewMessageContext = createContext<ReviewMessageContextValue | null>(null)
const pendingReviewContext = createContext(false)
const EMPTY_ACTIONS: ReviewAction[] = []
const EMPTY_ACTION_LAYOUT = {
  standaloneToolIds: new Set<string>(),
  reviewedToolIds: new Set<string>(),
}

/** Keeps bound actions visible without changing ordinary tool activity or workspace chat. */
export function useAssistantActionLayout() {
  return useContext(reviewMessageContext)?.layout ?? EMPTY_ACTION_LAYOUT
}

/** Lets the current turn yield its activity footer to pending review controls. */
export function useHasAssistantActionReview() {
  return useContext(pendingReviewContext)
}

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
  const refreshReceipts = useRefreshAssistantActionReceipts(organizationId, chatId ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [drafts, setDrafts] = useState<ReviewDrafts>({ runId: null, edits: {}, errors: {} })
  const actions = query.data?.actions ?? EMPTY_ACTIONS
  const runId = query.data?.runId ?? null
  const streamId = query.data?.streamId ?? null
  const byId = useMemo(
    () => new Map(actions.map((action) => [action.toolCallId, action])),
    [actions]
  )
  const { messageStreams, messageReceiptIds, turns } = useMemo(() => {
    const messageReceiptIds = new Map<string, ReadonlySet<string>>()
    const messageStreams = new Map<string, string>()
    const turns = new Map<string, ReviewTurn>()
    for (const message of messages) {
      messageReceiptIds.set(
        message.id,
        new Set(
          message.contentBlocks?.flatMap(({ toolCall }) =>
            toolCall &&
            getToolMetadata(toolCall.name)?.assistant &&
            (getToolMetadata(toolCall.name)?.assistant?.effect === 'write' ||
              toolCall.status === ToolCallStatus.awaiting_approval)
              ? [toolCall.id]
              : []
          )
        )
      )
      const messageStreamId =
        message.streamId ??
        (streamId && (message.id === streamId || message.id === getLiveAssistantMessageId(streamId))
          ? streamId
          : undefined)
      if (!messageStreamId) continue
      messageStreams.set(message.id, messageStreamId)
      const turn = turns.get(messageStreamId) ?? {
        messageId: message.id,
        representedIds: new Set<string>(),
        hasApprovalRows: false,
        writeIds: new Set<string>(),
      }
      turn.messageId = message.id
      for (const { toolCall } of message.contentBlocks ?? []) {
        if (!toolCall || !getToolMetadata(toolCall.name)?.assistant) continue
        turn.representedIds.add(toolCall.id)
        if (getToolMetadata(toolCall.name)?.assistant?.effect === 'write')
          turn.writeIds.add(toolCall.id)
        if (toolCall.status === ToolCallStatus.awaiting_approval) turn.hasApprovalRows = true
      }
      turns.set(messageStreamId, turn)
    }
    return { messageStreams, messageReceiptIds, turns }
  }, [messages, streamId])
  const currentTurn = streamId ? turns.get(streamId) : undefined
  const hasApprovalRows =
    currentTurn?.hasApprovalRows ??
    messages.some((message) =>
      message.contentBlocks?.some(
        ({ toolCall }) =>
          toolCall?.status === ToolCallStatus.awaiting_approval &&
          getToolMetadata(toolCall.name)?.assistant
      )
    )
  const recoveryMessageId =
    currentTurn?.messageId ?? (hasApprovalRows ? null : (messages.at(-1)?.id ?? null))
  const recoveryActions = actions.filter(
    (action) => !currentTurn?.representedIds.has(action.toolCallId)
  )

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
  const submit = async (
    selected: ReviewAction[],
    decision: 'allow' | 'skip',
    onStart: () => void
  ) => {
    if (inFlight.current || query.isError || !selected.length) return
    const controller = new AbortController()
    inFlight.current = controller
    onStart()
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
      await refreshReceipts()
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
              organizationId,
              chatId: chatId ?? '',
              active,
              streamId,
              messageStreams,
              messageReceiptIds,
              turns,
              recoveryMessageId,
              recoveryActions,
              hasApprovalRows,
              drafts,
              submitting,
              pendingDecision: mutation.isPending ? mutation.variables : undefined,
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
  isReceiptQueryOwner: boolean
  mountedReceiptTurnCount: number
  mountedMessageIds: readonly string[]
  children: ReactNode
}

export function AssistantActionReviewMessage({
  messageId,
  isReceiptQueryOwner,
  mountedReceiptTurnCount,
  mountedMessageIds,
  children,
}: AssistantActionReviewMessageProps) {
  const turn = useRef<HTMLDivElement>(null)
  const focusOrigin = useRef<HTMLButtonElement | null>(null)
  const review = useContext(reviewContext)
  const submitting = review?.submitting ?? false
  const streamId = review?.messageStreams.get(messageId)
  const receiptQuery = useAssistantActionTurnReceipts({
    organizationId: review?.organizationId ?? '',
    chatId: review?.chatId ?? '',
    streamId: streamId ?? '',
    active: Boolean(review?.active && review.streamId === streamId),
    enabled: isReceiptQueryOwner,
    mountedTurnCount: mountedReceiptTurnCount,
  })
  const pagedReceipts = new Map(
    receiptQuery.data?.pages
      .flatMap((page) => page.receipts)
      .map((receipt) => [receipt.toolCallId, receipt])
  )
  const receiptTurn = streamId ? review?.turns.get(streamId) : undefined
  const candidates = new Set([
    ...mountedMessageIds.flatMap((id) => [...(review?.messageReceiptIds.get(id) ?? [])]),
    ...(streamId && streamId === review?.streamId ? review.byId.keys() : []),
  ])
  const receiptBatches = useAssistantActionReceiptBatches({
    organizationId: review?.organizationId ?? '',
    chatId: review?.chatId ?? '',
    streamId: streamId ?? messageId,
    candidateIds: candidates,
    coveredIds: new Set(pagedReceipts.keys()),
    enabled: isReceiptQueryOwner && (!streamId || receiptQuery.isSuccess || receiptQuery.isError),
    pageCount: receiptQuery.data?.pages.length ?? 1,
    mountedTurnCount: mountedReceiptTurnCount,
  })
  const receiptQueries = new Map(
    receiptBatches.flatMap(({ ids, query }) => ids.map((id) => [id, query] as const))
  )
  const receipts = new Map([
    ...receiptBatches
      .flatMap(({ query }) => query.data?.receipts ?? [])
      .map((receipt) => [receipt.toolCallId, receipt] as const),
    ...pagedReceipts,
  ])
  const layout = {
    standaloneToolIds: new Set([
      ...(receiptTurn?.writeIds ?? []),
      ...receipts.keys(),
      ...(streamId && streamId === review?.streamId ? review.byId.keys() : []),
    ]),
    reviewedToolIds: new Set(
      [...receipts.values()]
        .filter((receipt) => receipt.state !== 'pending')
        .map((receipt) => receipt.toolCallId)
    ),
  }
  const ownsReceipts = receiptTurn?.messageId === messageId
  const missingRecovery = ownsReceipts
    ? receiptBatches.filter(({ ids }) =>
        ids.some(
          (id) => !receiptTurn.representedIds.has(id) && !review?.byId.has(id) && !receipts.has(id)
        )
      )
    : []
  const recoveryReceipts = ownsReceipts
    ? [...receipts.values()].filter(
        (receipt) =>
          !receiptTurn.representedIds.has(receipt.toolCallId) &&
          !review?.byId.has(receipt.toolCallId)
      )
    : []
  const ownsReview = review?.recoveryMessageId === messageId
  const recovery = new Map<
    string,
    { kind: 'review'; value: ReviewAction } | { kind: 'receipt'; value: Receipt }
  >()
  for (const receipt of recoveryReceipts)
    recovery.set(receipt.toolCallId, { kind: 'receipt', value: receipt })
  if (ownsReview) {
    for (const action of review.recoveryActions)
      recovery.set(action.toolCallId, { kind: 'review', value: action })
  }
  const recoveryItems = [...recovery.values()].sort(
    (left, right) =>
      (left.value.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.value.sequence ?? Number.MAX_SAFE_INTEGER)
  )

  useEffect(() => {
    const origin = focusOrigin.current
    if (!origin) return
    if (submitting) {
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
  }, [submitting])

  if (!review)
    return <pendingReviewContext.Provider value={false}>{children}</pendingReviewContext.Provider>
  const submit: ReviewMessageContextValue['submit'] = (actions, decision, source) => {
    void review.submit(actions, decision, () => {
      focusOrigin.current = document.activeElement === source ? source : null
    })
  }
  return (
    <reviewMessageContext.Provider
      value={{ messageId, streamId, receipts, receiptQuery, receiptQueries, layout, submit }}
    >
      <pendingReviewContext.Provider
        value={
          (ownsReview && (review.actions.length > 0 || review.submitting)) ||
          (ownsReceipts && [...receipts.values()].some((receipt) => receipt.unsettled))
        }
      >
        <div
          ref={turn}
          role='group'
          aria-label='Conversation turn'
          tabIndex={-1}
          className='min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--selection)]'
        >
          {children}
          {ownsReview &&
            !review.hasApprovalRows &&
            review.recoveryActions.length === 0 &&
            review.query.isError && (
              <div className='pt-4'>
                <ReviewAvailability label='Could not load action review' query={review.query} />
              </div>
            )}
          {recoveryItems.length > 0 && (
            <div className='flex flex-col gap-2 pb-3'>
              {recoveryItems.map((item) => (
                <div key={item.value.toolCallId}>
                  {item.kind === 'review' ? (
                    <ActionReview
                      key={item.value.proposalVersion}
                      action={item.value}
                      review={review}
                    />
                  ) : (
                    <AssistantActionReceipt receipt={item.value} />
                  )}
                </div>
              ))}
            </div>
          )}
          {missingRecovery.length > 0 && (
            <div className='flex items-center gap-2 pb-3'>
              <ActivityStatus
                label={
                  missingRecovery.some(({ query }) => query.isLoading)
                    ? 'Loading action history'
                    : 'Action details unavailable'
                }
                isActive={missingRecovery.some(({ query }) => query.isFetching)}
              />
              {missingRecovery.some(({ query }) => query.isError) && (
                <Chip
                  onClick={() => {
                    for (const { query } of missingRecovery) void query.refetch()
                  }}
                >
                  Retry
                </Chip>
              )}
            </div>
          )}
          {ownsReceipts && receiptQuery.isError && (
            <div className='flex items-center gap-2 pb-3'>
              <ActivityStatus label='Could not load action history' isActive={false} />
              <Chip disabled={receiptQuery.isFetching} onClick={() => void receiptQuery.refetch()}>
                Retry
              </Chip>
            </div>
          )}
          {ownsReceipts && receiptQuery.hasNextPage && (
            <div className='pb-3'>
              <Chip
                disabled={receiptQuery.isFetchingNextPage}
                onClick={() => void receiptQuery.fetchNextPage()}
              >
                More action history
              </Chip>
            </div>
          )}
          {ownsReview && <ReviewBatchActions review={review} />}
        </div>
      </pendingReviewContext.Provider>
    </reviewMessageContext.Provider>
  )
}

interface AssistantActionReviewStatusProps {
  toolCallId: string
  title: string
  fallback: ReactNode
  awaitingApproval?: boolean
}

export function AssistantActionReviewStatus({
  toolCallId,
  title,
  fallback,
  awaitingApproval = true,
}: AssistantActionReviewStatusProps) {
  const review = useContext(reviewContext)
  const message = useContext(reviewMessageContext)
  const receipt = message?.receipts.get(toolCallId)
  if (!review) return fallback
  if (message?.streamId === review.streamId) {
    const action = review.byId.get(toolCallId)
    if (action) return <ActionReview key={action.proposalVersion} action={action} review={review} />
  }
  if (receipt) return <AssistantActionReceipt receipt={receipt} />
  const batch = message?.receiptQueries.get(toolCallId)
  if (!awaitingApproval && !batch) return fallback
  if (review.query.isPending || message?.receiptQuery.isLoading || batch?.isPending)
    return <ReviewAvailability label='Loading action review' />
  if (
    message?.streamId === review.streamId &&
    !review.query.isError &&
    review.query.data?.nextCursor != null
  )
    return <ReviewAvailability label='Review the current batch first' />
  if (review.query.isError)
    return <ReviewAvailability label='Could not load action review' query={review.query} />
  if (batch?.isError)
    return <ReviewAvailability label='Could not load action history' query={batch} />
  if (message?.receiptQuery.isError && !batch?.isSuccess)
    return <ReviewAvailability label='Could not load action history' query={message.receiptQuery} />
  if (!awaitingApproval) return fallback
  return <ActivityStatus label={`${title} · No longer waiting for review`} isActive={false} />
}

interface ReviewAvailabilityProps {
  label: string
  query?: { isFetching: boolean; refetch: () => Promise<unknown> }
}

function ReviewAvailability({ label, query }: ReviewAvailabilityProps) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <ActivityStatus label={label} isActive={false} icon={<ShieldCheck className='size-full' />} />
      {query && (
        <Chip disabled={query.isFetching} onClick={() => void query.refetch()}>
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
  const [editing, setEditing] = useState(false)
  const { title } = assistantActionPresentation(action)
  const message = useContext(reviewMessageContext)
  const draft =
    review.drafts.runId === action.runId ? review.drafts.edits[action.toolCallId] : undefined
  const edits = draft?.proposalVersion === action.proposalVersion ? draft.fields : {}
  const error =
    review.drafts.runId === action.runId ? review.drafts.errors[action.toolCallId] : undefined
  const disabled = review.submitting || review.query.isError
  const pendingDecision =
    review.pendingDecision?.toolCallId === action.toolCallId
      ? review.pendingDecision.decision
      : null
  const display = action.account
    ? resolveCredentialDisplay({ ...action.account, type: 'managed_oauth' })
    : undefined
  return (
    <section aria-label={`Review ${title}`} aria-busy={review.submitting} className='min-w-0'>
      <InteractionCard
        title={
          <span className='flex min-w-0 items-center gap-2'>
            {display?.icon ? (
              <BrandIcon icon={display.icon} className='size-[14px] shrink-0' />
            ) : (
              <ShieldCheck className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            )}
            <span className='min-w-0 break-words'>{title}</span>
          </span>
        }
        actions={
          action.fields.some((field) => field.editable) ? (
            <Chip disabled={disabled} onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Edit'}
            </Chip>
          ) : undefined
        }
      >
        <div className='flex flex-col gap-3 px-2 pb-2'>
          {editing ? (
            <div className='grid gap-3 sm:grid-cols-2'>
              <p className='col-span-full break-words text-[var(--text-body)] text-small'>
                <span className='mr-3 text-[var(--text-muted)] text-caption'>Account</span>
                {action.account?.displayName ?? 'Account unavailable'}
              </p>
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
          ) : (
            <ActionPreview
              account={action.account?.displayName ?? 'Account unavailable'}
              action={{
                ...action,
                fields: action.fields.map((field) => ({
                  ...field,
                  value: edits[field.name] ?? field.value,
                })),
              }}
            />
          )}
          {!action.account?.active && (
            <p className='text-[var(--text-muted)] text-small'>
              This account is no longer available.
            </p>
          )}
          {review.query.isError && (
            <ReviewAvailability label='Could not refresh action review' query={review.query} />
          )}
          {error?.proposalVersion === action.proposalVersion && (
            <p role='alert' className='text-[var(--text-error)] text-caption'>
              {error.message}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-2 border-[var(--border)] border-t pt-2'>
            <Chip
              variant='primary'
              disabled={disabled || !action.account?.active}
              onClick={(event) => message?.submit([action], 'allow', event.currentTarget)}
            >
              {pendingDecision === 'allow' ? 'Saving…' : 'Allow'}
            </Chip>
            <Chip
              disabled={disabled}
              onClick={(event) => message?.submit([action], 'skip', event.currentTarget)}
            >
              {pendingDecision === 'skip' ? 'Saving…' : 'Cancel'}
            </Chip>
          </div>
        </div>
      </InteractionCard>
    </section>
  )
}

interface ReviewBatchActionsProps {
  review: ReviewContextValue
}

function ReviewBatchActions({ review }: ReviewBatchActionsProps) {
  const message = useContext(reviewMessageContext)
  const disabled = review.submitting || review.query.isError
  const hasMore = review.query.data?.nextCursor != null
  if (review.actions.length < 2 && !review.submitting && !hasMore) return null
  return (
    <div className='flex flex-col gap-3 pb-4'>
      {review.actions.length > 1 && (
        <div aria-busy={review.submitting} className='flex flex-wrap items-center gap-2'>
          <Chip
            disabled={disabled || review.actions.some((action) => !action.account?.active)}
            onClick={(event) => message?.submit(review.actions, 'allow', event.currentTarget)}
          >
            Allow {review.actions.length} shown
          </Chip>
          <Chip
            disabled={disabled}
            onClick={(event) => message?.submit(review.actions, 'skip', event.currentTarget)}
          >
            Cancel {review.actions.length} shown
          </Chip>
        </div>
      )}
      {review.submitting ? (
        <ActivityStatus label='Saving review' isActive />
      ) : (
        hasMore && (
          <p className='text-[var(--text-muted)] text-caption'>More actions are waiting.</p>
        )
      )}
    </div>
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
  const display = assistantActionFieldPresentation({ ...field, value })
  return field.editable ? (
    <div className='col-span-full flex flex-col gap-[9px]'>
      <label htmlFor={id} className='text-[var(--text-muted)] text-small'>
        {display.label}
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
      <dt className='text-[var(--text-muted)] text-small'>{display.label}</dt>
      <dd className='whitespace-pre-wrap break-words text-[var(--text-body)] text-small'>
        {display.value}
      </dd>
    </dl>
  )
}
