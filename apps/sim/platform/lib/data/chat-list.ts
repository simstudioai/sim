'use client'

import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { organizationRoutes } from '@/lib/navigation/paths'
import {
  MothershipChatDeleteError,
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'

/** Assistant chats live under Search, agent chats at the chat route. */
export function organizationChatHref(
  chat: { id: string; mode?: string },
  routes: ReturnType<typeof organizationRoutes>
) {
  return chat.mode === 'assistant' ? routes.searchChat(chat.id) : routes.chat(chat.id)
}

/** A partial bulk failure still reports which chats went, so the view can narrow what is left. */
interface ChatRemoval {
  removedIds: readonly string[]
  failure?: string
}

/** Failures of a fire-and-forget action report through a toast. */
export function useChatListActions(organizationId: string) {
  const owner = { organizationId }
  const { mutateAsync: deleteChat } = useDeleteMothershipChat(owner)
  const { mutateAsync: deleteChats } = useDeleteMothershipChats(owner)
  const { mutateAsync: renameChat } = useRenameMothershipChat(owner)
  const { mutate: pinChat } = useSetMothershipChatPinned(owner)
  const { mutate: readChat } = useMarkMothershipChatRead(owner)
  const { mutate: unreadChat } = useMarkMothershipChatUnread(owner)
  const reportFailure = { onError: (error: Error) => void toast.error(error.message) }
  return {
    rename: async (chatId: string, title: string) => {
      await renameChat({ chatId, title })
    },
    async remove(ids: readonly string[]): Promise<ChatRemoval> {
      try {
        if (ids.length === 1) await deleteChat(ids[0])
        else await deleteChats([...ids])
        return { removedIds: ids }
      } catch (error) {
        return {
          removedIds: error instanceof MothershipChatDeleteError ? error.deletedChatIds : [],
          failure: getErrorMessage(error, 'Failed to delete'),
        }
      }
    },
    setPinned: (chatId: string, pinned: boolean) => pinChat({ chatId, pinned }, reportFailure),
    setRead: (chatId: string, read: boolean) =>
      read ? readChat(chatId, reportFailure) : unreadChat(chatId, reportFailure),
  }
}
