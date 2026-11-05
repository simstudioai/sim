'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import {
  MothershipChatDeleteError,
  mothershipChatHistoryQueryOptions,
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'
import type { ShellChatActions } from '@/platform/app/(shell)/_components/model'
import { toast } from '@/platform/lib/data/toast'

const CHAT_PREFETCH_DWELL_MS = 80

/** The legacy sidebar's chat mutations, for one organization's list. */
export function useChatListActions(organizationId: string): ShellChatActions {
  const owner = { organizationId }
  const queryClient = useQueryClient()
  const { mutateAsync: deleteChat } = useDeleteMothershipChat(owner)
  const { mutateAsync: deleteChats } = useDeleteMothershipChats(owner)
  const { mutateAsync: renameChat } = useRenameMothershipChat(owner)
  const { mutate: pinChat } = useSetMothershipChatPinned(owner)
  const { mutate: readChat } = useMarkMothershipChatRead(owner)
  const { mutate: unreadChat } = useMarkMothershipChatUnread(owner)
  const reportFailure = { onError: (error: Error) => void toast.error(error.message) }
  return {
    removeLabel: 'Delete',
    rename: (chatId, title) => renameChat({ chatId, title }),
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
    prefetch(chatId) {
      const options = mothershipChatHistoryQueryOptions(chatId)
      const timer = setTimeout(() => {
        if (queryClient.getQueryData(options.queryKey) === undefined)
          prefetchQueryOnIntent(queryClient, options)
      }, CHAT_PREFETCH_DWELL_MS)
      return () => clearTimeout(timer)
    },
  }
}
