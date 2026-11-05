'use client'

import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  MothershipChatDeleteError,
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import type { ShellChatActions } from '@/platform/app/(shell)/_components/model'

/** One organization's chat mutations. Failures of a fire-and-forget action report through a toast. */
export function useChatListActions(organizationId: string): Omit<ShellChatActions, 'retry'> {
  const owner = { organizationId }
  const { mutateAsync: deleteChat } = useDeleteMothershipChat(owner)
  const { mutateAsync: deleteChats } = useDeleteMothershipChats(owner)
  const { mutateAsync: renameChat } = useRenameMothershipChat(owner)
  const { mutate: pinChat } = useSetMothershipChatPinned(owner)
  const { mutate: readChat } = useMarkMothershipChatRead(owner)
  const { mutate: unreadChat } = useMarkMothershipChatUnread(owner)
  const reportFailure = { onError: (error: Error) => void toast.error(error.message) }
  return {
    rename: async (chatId, title) => {
      await renameChat({ chatId, title })
    },
    async remove(ids) {
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
    setPinned: (chatId, pinned) => pinChat({ chatId, pinned }, reportFailure),
    setRead: (chatId, read) =>
      read ? readChat(chatId, reportFailure) : unreadChat(chatId, reportFailure),
  }
}
