'use client'

import { useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  assistantActionFieldPresentation,
  assistantActionPresentation,
} from '@/components/assistant-actions/presentation'
import type {
  AssistantActionReceiptsResponse,
  AssistantActionsResponse,
} from '@/lib/api/contracts/assistant-actions'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/live-message-id'
import type { ChatMessage } from '@/lib/mothership/chat/types'
import type {
  AssistantReceipt,
  AssistantReviewField,
  ChatRuntime,
} from '@/app/(product)/_components/chat/model'
import {
  useAssistantActionReview,
  useAssistantActionTurnReceipts,
  useDecideAssistantAction,
  useRefreshAssistantActionReceipts,
} from '@/hooks/queries/assistant-actions'

type ReceiptState = AssistantActionReceiptsResponse['receipts'][number]['state']

const RECEIPT_LABELS: Record<ReceiptState, string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  running: 'Running',
  succeeded: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  uncertain: 'Outcome unknown',
}

type ReviewedField = AssistantActionsResponse['actions'][number]['fields'][number]

/** A field as the review shows it: readable label, enum text, and indented JSON. */
function presentField(field: ReviewedField): AssistantReviewField {
  const display = assistantActionFieldPresentation(field)
  let value = display.value
  if (field.format === 'json') {
    try {
      value = JSON.stringify(JSON.parse(value), null, 2)
    } catch {}
  }
  return {
    name: field.name,
    label: display.label,
    value,
    editable: field.editable,
    multiline: field.format !== 'text',
  }
}

interface AssistantReviewOptions {
  organizationId: string
  chatId?: string
  messages: readonly ChatMessage[]
  active: boolean
  enabled: boolean
}

/**
 * The actions an Assistant turn is holding for review, through the same queries as the legacy review
 * card. Decisions go one action at a time, so a failure on one leaves the rest as the person left
 * them and is reported on that action's card.
 */
export function useAssistantReview({
  organizationId,
  chatId,
  messages,
  active,
  enabled,
}: AssistantReviewOptions): ChatRuntime['review'] {
  const review = useAssistantActionReview(organizationId, chatId ?? '', active, enabled)
  const decide = useDecideAssistantAction(organizationId, chatId ?? '')
  const refreshReceipts = useRefreshAssistantActionReceipts(organizationId, chatId ?? '')
  const [pending, setPending] = useState(false)
  const { data: reviewData, refetch, isError, isPending } = review
  const currentStreamId = reviewData?.streamId ?? null
  const { mutateAsync: decideAction } = decide
  const streamIds = useMemo(() => {
    const streams = new Map<string, string>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const live =
        currentStreamId &&
        (message.id === currentStreamId ||
          message.id === getLiveAssistantMessageId(currentStreamId))
      const streamId = message.streamId ?? (live ? currentStreamId : undefined)
      if (streamId) streams.set(message.id, streamId)
    }
    return streams
  }, [messages, currentStreamId])
  let turnId: string | undefined
  for (const [messageId, streamId] of streamIds) {
    if (streamId === currentStreamId) turnId = messageId
  }
  for (let index = messages.length - 1; index >= 0 && !turnId; index--) {
    if (messages[index].role === 'assistant') turnId = messages[index].id
  }
  // Rebuilt only when a read changes, so a stream chunk leaves settled turns alone.
  return useMemo(() => {
    if (!enabled) return undefined
    const actions = reviewData?.actions ?? []
    return {
      turnId,
      chatId,
      active,
      streamIds,
      status: isError ? 'error' : isPending ? 'loading' : 'ready',
      pending,
      more: reviewData?.nextCursor != null,
      retry: () => void refetch(),
      actions: actions.map((action) => ({
        id: action.toolCallId,
        title: assistantActionPresentation(action).title,
        account: action.account
          ? { name: action.account.displayName, active: action.account.active }
          : undefined,
        fields: action.fields.filter((field) => field.value || field.editable).map(presentField),
      })),
      decide: async (ids, decision, edits) => {
        setPending(true)
        const failures: Record<string, string> = {}
        try {
          for (const id of ids) {
            const action = actions.find((item) => item.toolCallId === id)
            if (!action) continue
            const changed = Object.fromEntries(
              Object.entries(edits?.[id] ?? {}).filter(([name, value]) => {
                const field = action.fields.find((item) => item.name === name)
                return field?.editable && field.value !== value
              })
            )
            try {
              await decideAction({
                toolCallId: id,
                runId: action.runId,
                proposalVersion: action.proposalVersion,
                decision,
                ...(decision === 'allow' && Object.keys(changed).length ? { edits: changed } : {}),
              })
            } catch (error) {
              failures[id] = getErrorMessage(error, 'Could not save this review')
            }
          }
        } finally {
          await refreshReceipts()
          setPending(false)
        }
        return failures
      },
    }
  }, [
    enabled,
    turnId,
    chatId,
    active,
    streamIds,
    reviewData,
    refetch,
    isError,
    isPending,
    decideAction,
    refreshReceipts,
    pending,
  ])
}

interface TurnReceiptsOptions {
  organizationId: string
  chatId: string
  streamId: string
  /** The turn's stream is still running, so its receipts poll. */
  active: boolean
  /** How many turns read receipts at once, which spaces out their polling. */
  mountedTurnCount: number
}

/**
 * One assistant turn's action receipts, a page at a time, as the legacy turn read them: what each
 * action did, with the approved fields while they are still available.
 */
export function useTurnReceipts({
  organizationId,
  chatId,
  streamId,
  active,
  mountedTurnCount,
}: TurnReceiptsOptions) {
  const query = useAssistantActionTurnReceipts({
    organizationId,
    chatId,
    streamId,
    active,
    enabled: true,
    mountedTurnCount,
  })
  const pages = query.data?.pages
  const receipts = useMemo<AssistantReceipt[]>(
    () =>
      (pages ?? [])
        .flatMap((page) => page.receipts)
        .map((receipt) => {
          const presentation = assistantActionPresentation(receipt)
          const lead = presentation.primary[0]
          return {
            id: receipt.toolCallId,
            title: presentation.title,
            state: receipt.state,
            stateLabel: RECEIPT_LABELS[receipt.state],
            summary: lead ? assistantActionFieldPresentation(lead).value : undefined,
            warning: receipt.warning ?? undefined,
            account: receipt.account?.displayName,
            fields: receipt.detailsAvailable
              ? receipt.fields.filter((field) => field.value !== '').map(presentField)
              : undefined,
          }
        }),
    [pages]
  )
  return {
    receipts,
    status: query.isError ? 'error' : query.isPending ? 'loading' : 'ready',
    retrying: query.isFetching,
    retry: () => void query.refetch(),
    more: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  } as const
}
