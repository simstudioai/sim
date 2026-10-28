import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isCancelledError, useQueryClient } from '@tanstack/react-query'
import {
  loadOlderMothershipChatMessages,
  type MothershipChatHistory,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'

const logger = createLogger('MothershipChatOlderMessages')

/**
 * Loads a chat's older messages behind its newest window, a page at a time, so the whole
 * transcript is in place before the user scrolls back to it. Each page moves the cached
 * `olderCursor`, which loads the next, until the chat's first message arrives.
 *
 * Writing pages into the detail entry, rather than a separate infinite query, keeps every
 * reader of `detail.messages` (send, find, sources, fork) on one transcript.
 */
export function useMothershipChatOlderMessages(
  chatId: string | undefined,
  history: Pick<MothershipChatHistory, 'olderCursor' | 'olderMessagesFailed'> | undefined
) {
  const queryClient = useQueryClient()
  const olderCursor = history?.olderMessagesFailed ? null : history?.olderCursor
  useEffect(() => {
    if (!chatId || !olderCursor) return
    const queryKey = mothershipChatKeys.olderMessages(chatId, olderCursor)
    loadOlderMothershipChatMessages(queryClient, chatId, olderCursor).catch((error) => {
      if (isCancelledError(error)) return
      logger.warn('Failed to load older chat messages', {
        chatId,
        error: toError(error).message,
      })
      // The page failed for good: record it so readers waiting on older history (the Sources
      // panel) settle on an error instead of loading forever.
      queryClient.setQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId),
        (current) =>
          current?.olderCursor === olderCursor ? { ...current, olderMessagesFailed: true } : current
      )
    })
    return () => {
      void queryClient.cancelQueries({ queryKey, exact: true })
    }
  }, [queryClient, chatId, olderCursor])
}
