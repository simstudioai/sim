'use client'

import { useCallback, useMemo } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useChatHistory')

interface UseChatHistoryProps {
  chats: any[]
  activeWorkflowId: string | null
  copilotWorkflowId: string | null
  loadChats: (forceRefresh: boolean) => Promise<void>
  areChatsFresh: (workflowId: string) => boolean
  isSendingMessage: boolean
}

/**
 * Custom hook to manage chat history grouping and loading
 *
 * @param props - Chat history configuration
 * @returns Chat history utilities
 */
export function useChatHistory(props: UseChatHistoryProps) {
  const { chats, activeWorkflowId, copilotWorkflowId, loadChats, areChatsFresh, isSendingMessage } =
    props

  /**
   * Groups chats by time period (Today, Yesterday, This Week, etc.)
   */
  const groupedChats = useMemo(() => {
    if (!activeWorkflowId || copilotWorkflowId !== activeWorkflowId || chats.length === 0) {
      return []
    }

    const filteredChats = chats
    if (filteredChats.length === 0) {
      return []
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const thisWeekStart = new Date(today.getTime() - today.getDay() * 24 * 60 * 60 * 1000)
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

    const groups: Record<string, typeof filteredChats> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      'Last Week': [],
      Older: [],
    }

    filteredChats.forEach((chat) => {
      const chatDate = new Date(chat.updatedAt)
      const chatDay = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate())

      if (chatDay.getTime() === today.getTime()) {
        groups.Today.push(chat)
      } else if (chatDay.getTime() === yesterday.getTime()) {
        groups.Yesterday.push(chat)
      } else if (chatDay.getTime() >= thisWeekStart.getTime()) {
        groups['This Week'].push(chat)
      } else if (chatDay.getTime() >= lastWeekStart.getTime()) {
        groups['Last Week'].push(chat)
      } else {
        groups.Older.push(chat)
      }
    })

    return Object.entries(groups).filter(([, chats]) => chats.length > 0)
  }, [chats, activeWorkflowId, copilotWorkflowId])

  /**
   * Handles history dropdown opening and loads chats if needed
   * Does not await loading - fires in background to avoid blocking UI
   */
  const handleHistoryDropdownOpen = useCallback(
    (open: boolean) => {
      // Only load if opening dropdown AND we don't have fresh chats AND not streaming
      if (open && activeWorkflowId && !isSendingMessage && !areChatsFresh(activeWorkflowId)) {
        // Fire in background, don't await - same pattern as old panel
        loadChats(false).catch((error) => {
          logger.error('Failed to load chat history:', error)
        })
      }

      if (open && isSendingMessage) {
        logger.info('Chat history opened during stream - showing cached data only')
      }
    },
    [activeWorkflowId, areChatsFresh, isSendingMessage, loadChats]
  )

  return {
    groupedChats,
    handleHistoryDropdownOpen,
  }
}
