import { useCallback } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

export const copilotChatSelectionKeys = {
  all: ['copilot-chat-selection'] as const,
  workflows: () => [...copilotChatSelectionKeys.all, 'workflow'] as const,
  workflow: (workflowId?: string) =>
    [...copilotChatSelectionKeys.workflows(), workflowId ?? ''] as const,
}

/**
 * Reactive per-workflow copilot chat selection. Values are written via the
 * returned setter; queryFn is `skipToken` so the cache only ever holds
 * what setQueryData puts there.
 */
export function useCopilotChatSelection(workflowId?: string) {
  const queryClient = useQueryClient()

  const { data: chatId } = useQuery<string | null>({
    queryKey: copilotChatSelectionKeys.workflow(workflowId),
    queryFn: skipToken,
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
