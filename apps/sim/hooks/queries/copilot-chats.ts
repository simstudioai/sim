import { skipToken, useQuery } from '@tanstack/react-query'

export interface CopilotChatListItem {
  id: string
  title: string | null
  workflowId?: string
  updatedAt: string
  activeStreamId: string | null
}

export const copilotChatsKeys = {
  all: ['copilot-chats'] as const,
  lists: () => [...copilotChatsKeys.all, 'list'] as const,
  list: (workflowId?: string) => [...copilotChatsKeys.lists(), workflowId ?? ''] as const,
}

async function fetchCopilotChats(
  workflowId: string,
  signal?: AbortSignal
): Promise<CopilotChatListItem[]> {
  const res = await fetch('/api/copilot/chats', { signal })
  if (!res.ok) return []
  const data = await res.json()
  const all = Array.isArray(data?.chats) ? (data.chats as CopilotChatListItem[]) : []
  return all.filter((c) => c.workflowId === workflowId)
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
