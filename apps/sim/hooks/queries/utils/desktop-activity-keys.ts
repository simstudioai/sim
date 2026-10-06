import type { QueryClient } from '@tanstack/react-query'
import type { DesktopChatActivity } from '@/lib/api/contracts/desktop-executor'

export const desktopActivityKeys = {
  all: ['desktop-activity'] as const,
  lists: () => [...desktopActivityKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...desktopActivityKeys.lists(), workspaceId ?? ''] as const,
}

/**
 * Whether one of the user's desktops is running this chat's turn in the background, read from
 * the cached activity list. Its calls then belong to that desktop; the chat view only shows them.
 */
export function isChatRunOnDesktop(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  chatId: string | undefined
): boolean {
  if (!workspaceId || !chatId) return false
  const chats = queryClient.getQueryData<DesktopChatActivity[]>(
    desktopActivityKeys.list(workspaceId)
  )
  return chats?.some((chat) => chat.chatId === chatId) ?? false
}
