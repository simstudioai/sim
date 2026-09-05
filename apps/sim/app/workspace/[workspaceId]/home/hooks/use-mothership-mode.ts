'use client'

import { useCallback } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import {
  CLEARED_SEARCH_FILTERS,
  composerModeParsers,
  type MothershipMode,
  resourceUrlKeys,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useMothershipChatHistory } from '@/hooks/queries/mothership-chats'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'

/**
 * Existing conversations retain their persisted mode. The URL owns Search and
 * the mode of a new conversation; changing a conversation's mode starts a new one.
 */
export function useMothershipMode() {
  const memberAccessAvailable = useMemberAccessAvailable()
  const { workspaceId, chatId } = useParams<{ workspaceId: string; chatId?: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const [{ mode: urlMode }, setParams] = useQueryStates(composerModeParsers, resourceUrlKeys)
  const { data: chatHistory } = useMothershipChatHistory(chatId)
  const persistedMode = chatHistory?.messages.find(
    (message) => message.role === 'user' && message.requestMode
  )?.requestMode
  const mode =
    urlMode === 'search' || !persistedMode
      ? urlMode
      : persistedMode === 'assistant'
        ? 'assistant'
        : 'build'
  const setMode = useCallback(
    async (next: MothershipMode) => {
      if (next !== 'build' && !memberAccessAvailable) return
      if (next !== mode && next !== 'search' && pathname.includes('/chat/')) {
        router.push(
          `/workspace/${workspaceId}/home${next === 'assistant' ? '?mode=assistant' : ''}`
        )
        return Promise.resolve(new URLSearchParams(next === 'assistant' ? 'mode=assistant' : ''))
      }
      return setParams(
        {
          mode: next,
          ...(next === 'search' ? {} : { q: null, ...CLEARED_SEARCH_FILTERS }),
        },
        { history: 'replace', scroll: false }
      )
    },
    [setParams, mode, pathname, router, workspaceId, memberAccessAvailable]
  )

  return [memberAccessAvailable ? mode : 'build', setMode] as const
}
