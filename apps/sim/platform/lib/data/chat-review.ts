'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { assistantActionPresentation } from '@/components/assistant-actions/presentation'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'
import {
  useAssistantActionReview,
  useAssistantActionTurnReceipts,
  useDecideAssistantAction,
} from '@/hooks/queries/assistant-actions'
import type { ChatRuntime } from '@/platform/app/(shell)/_components/chat/model'

const RECEIPT_LABELS: Record<string, string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  running: 'Running',
  succeeded: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  uncertain: 'Outcome unknown',
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
 * them and reports which it was.
 */
export function useAssistantReview({
  organizationId,
  chatId,
  messages,
  active,
  enabled,
}: AssistantReviewOptions): ChatRuntime['review'] {
  const review = useAssistantActionReview(organizationId, chatId ?? '', active, enabled)
  const streamId = review.data?.streamId
  const receipts = useAssistantActionTurnReceipts({
    organizationId,
    chatId: chatId ?? '',
    streamId: streamId ?? '',
    active,
    enabled: enabled && Boolean(chatId && streamId),
    mountedTurnCount: 1,
  })
  const decide = useDecideAssistantAction(organizationId, chatId ?? '')
  const [pending, setPending] = useState(false)
  let turnId: string | undefined
  for (let index = messages.length - 1; index >= 0 && !turnId; index--) {
    if (messages[index].role === 'assistant') turnId = messages[index].id
  }
  if (!enabled) return undefined
  const actions = review.data?.actions ?? []
  return {
    turnId,
    status: review.isError ? 'error' : review.isPending ? 'loading' : 'ready',
    pending,
    retry: () => void review.refetch(),
    actions: actions.map((action) => ({
      id: action.toolCallId,
      title: assistantActionPresentation(action).title,
      account: action.account
        ? { name: action.account.displayName, active: action.account.active }
        : undefined,
      fields: action.fields.map((field) => ({
        name: field.name,
        label: field.label,
        value: field.value,
        editable: field.editable,
        multiline: field.format !== 'text',
      })),
    })),
    receipts: (receipts.data?.pages ?? [])
      .flatMap((page) => page.receipts)
      .map((receipt) => ({
        id: receipt.toolCallId,
        title: assistantActionPresentation(receipt).title,
        state: receipt.state,
        stateLabel: RECEIPT_LABELS[receipt.state] ?? receipt.state,
        warning: receipt.warning ?? undefined,
      })),
    decide: async (ids, decision, edits) => {
      setPending(true)
      const failures: string[] = []
      try {
        for (const id of ids) {
          const action = actions.find((item) => item.toolCallId === id)
          if (!action || !review.data?.runId) continue
          const changed = Object.fromEntries(
            Object.entries(edits?.[id] ?? {}).filter(([name, value]) => {
              const field = action.fields.find((item) => item.name === name)
              return field?.editable && field.value !== value
            })
          )
          try {
            await decide.mutateAsync({
              toolCallId: id,
              runId: review.data.runId,
              proposalVersion: action.proposalVersion,
              decision,
              ...(decision === 'allow' && Object.keys(changed).length ? { edits: changed } : {}),
            })
          } catch (error) {
            failures.push(getErrorMessage(error, 'Could not save this review'))
          }
        }
      } finally {
        setPending(false)
      }
      if (failures.length) throw new Error(failures[0])
    },
  }
}
