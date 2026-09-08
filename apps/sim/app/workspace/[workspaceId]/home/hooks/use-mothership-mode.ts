'use client'

import { useCallback } from 'react'
import { useParams } from 'next/navigation'
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
 * URL selection owns the current view and next turn. A bare chat link resumes
 * the latest persisted user mode without changing the mode of any active run.
 */
export function useMothershipMode() {
  const memberAccessAvailable = useMemberAccessAvailable()
  const { chatId } = useParams<{ chatId?: string }>()
  const [{ mode: urlMode, q: query }, setParams] = useQueryStates(
    composerModeParsers,
    resourceUrlKeys
  )
  const { data: chatHistory } = useMothershipChatHistory(chatId)
  let persistedMode: 'agent' | 'assistant' | undefined
  for (const message of chatHistory?.messages ?? []) {
    if (message.role === 'user') persistedMode = message.requestMode
  }
  const mode =
    urlMode ?? (query?.trim() ? 'search' : persistedMode === 'assistant' ? 'assistant' : 'build')
  const setMode = useCallback(
    async (next: MothershipMode) => {
      if (next !== 'build' && !memberAccessAvailable) return
      return setParams(
        {
          mode: next,
          ...(next === 'search' ? {} : { q: null, ...CLEARED_SEARCH_FILTERS }),
        },
        { history: 'replace', scroll: false }
      )
    },
    [setParams, memberAccessAvailable]
  )

  return [memberAccessAvailable ? mode : 'build', setMode] as const
}
