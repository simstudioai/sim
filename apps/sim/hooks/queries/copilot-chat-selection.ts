import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export const copilotChatSelectionKeys = {
  all: ['copilot-chat-selection'] as const,
  workflows: () => [...copilotChatSelectionKeys.all, 'workflow'] as const,
  workflow: (workflowId?: string) =>
    [...copilotChatSelectionKeys.workflows(), workflowId ?? ''] as const,
}

/**
 * Reactive per-workflow copilot chat selection. The active workflow's
 * chatId lives in the React Query cache under a workflow-keyed entry, so
 * switching workflows naturally reads the per-workflow remembered value
 * with no save/restore effect required. No `queryFn` runs — values land
 * exclusively via the returned setter.
 *
 * In-memory only (no `persistQueryClient`); refresh wipes the memory and
 * the panel falls back to auto-selecting the workflow's most recent chat.
 */
export function useCopilotChatSelection(workflowId?: string) {
  const queryClient = useQueryClient()

  const { data: chatId } = useQuery({
    queryKey: copilotChatSelectionKeys.workflow(workflowId),
    queryFn: (): string | null => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    initialData: null,
  })

  const setChatId = useCallback(
    (next: string | undefined) => {
      if (!workflowId) return
      queryClient.setQueryData<string | null>(
        copilotChatSelectionKeys.workflow(workflowId),
        next ?? null
      )
    },
    [workflowId, queryClient]
  )

  return { chatId: chatId ?? undefined, setChatId }
}
