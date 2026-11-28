import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type CopilotChatListItem,
  deleteCopilotChatContract,
  listCopilotChatsContract,
} from '@/lib/api/contracts/copilot'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

export type { CopilotChatListItem }

export const copilotChatsKeys = {
  all: ['copilot-chats'] as const,
  lists: () => [...copilotChatsKeys.all, 'list'] as const,
  list: (workflowId?: string) => [...copilotChatsKeys.lists(), workflowId ?? ''] as const,
}

export const COPILOT_CHAT_LIST_STALE_TIME = 30 * 1000

async function fetchCopilotChats(
  workflowId: string,
  signal?: AbortSignal
): Promise<CopilotChatListItem[]> {
  try {
    const data = await requestJson(listCopilotChatsContract, { signal })
    return data.chats.filter((c) => c.workflowId === workflowId)
  } catch (error) {
    if (error instanceof ApiClientError) return []
    throw error
  }
}

/**
 * Workflow-scoped copilot chat list. Each workflowId has its own cache entry
 * so switching workflows reads the right list synchronously instead of
 * showing the previous workflow's chats during the refetch.
 */
export function useCopilotChats(workflowId?: string) {
  return useQuery<CopilotChatListItem[]>({
    queryKey: copilotChatsKeys.list(workflowId),
    queryFn: workflowId ? ({ signal }) => fetchCopilotChats(workflowId, signal) : skipToken,
    staleTime: COPILOT_CHAT_LIST_STALE_TIME,
  })
}

interface DeleteCopilotChatVariables {
  chatId: string
  /** Workflow whose chat list drops the chat, captured when the delete starts. */
  workflowId?: string
  /** Persisted composer draft to prune once the chat is gone. */
  draftKey?: string
}

/** Deletes a workflow copilot chat, prunes its draft, and refreshes its workflow's chat list. */
export function useDeleteCopilotChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chatId }: DeleteCopilotChatVariables) =>
      requestJson(deleteCopilotChatContract, { body: { chatId } }),
    onSuccess: (_data, { workflowId, draftKey }) => {
      // The draft store is persisted, so an unpruned key survives forever.
      if (draftKey) useMothershipDraftsStore.getState().clearDraft(draftKey)
      return queryClient.invalidateQueries({ queryKey: copilotChatsKeys.list(workflowId) })
    },
  })
}
