import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export const copilotChatSelectionKeys = {
  all: ['copilot-chat-selection'] as const,
  workflows: () => [...copilotChatSelectionKeys.all, 'workflow'] as const,
  workflow: (workflowId?: string) =>
    [...copilotChatSelectionKeys.workflows(), workflowId ?? ''] as const,
}

/**
 * In-memory selection of which copilot chat is active per workflow.
 * Backed by the React Query cache as a keyed KV store — no `queryFn`,
 * values only land via `setChatId`. Survives in-session workflow switches
 * so A → B → A returns to A's last-used chat; cleared on hard refresh.
 */
export function useCopilotChatSelection() {
  const queryClient = useQueryClient()

  const getChatId = useCallback(
    (workflowId: string): string | undefined =>
      queryClient.getQueryData<string>(copilotChatSelectionKeys.workflow(workflowId)),
    [queryClient]
  )

  const setChatId = useCallback(
    (workflowId: string, chatId: string | undefined) => {
      queryClient.setQueryData<string | undefined>(
        copilotChatSelectionKeys.workflow(workflowId),
        chatId
      )
    },
    [queryClient]
  )

  return { getChatId, setChatId }
}
