import { skipToken, useQuery } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { type CopilotChatListItem, listCopilotChatsContract } from '@/lib/api/contracts/copilot'

export type { CopilotChatListItem }

export const copilotChatsKeys = {
  all: ['copilot-chats'] as const,
  lists: () => [...copilotChatsKeys.all, 'list'] as const,
  list: (workflowId?: string) => [...copilotChatsKeys.lists(), workflowId ?? ''] as const,
}

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
    staleTime: 30 * 1000,
  })
}
