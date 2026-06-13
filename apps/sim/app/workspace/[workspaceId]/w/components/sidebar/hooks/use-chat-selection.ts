import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseChatSelectionProps {
  /**
   * Flat array of all chat IDs in display order
   */
  chatIds: string[]
}

/**
 * Hook for managing chat selection with support for single and range selection.
 * Handles shift-click for range selection.
 * cmd/ctrl+click is handled by the browser (opens in new tab) and never reaches this handler.
 * Uses the last selected chat as the anchor point for range selections.
 * Selecting chats clears workflow/folder selections and vice versa.
 */
export function useChatSelection({ chatIds }: UseChatSelectionProps) {
  const selectedChats = useFolderStore((s) => s.selectedChats)

  const handleChatClick = useCallback(
    (chatId: string, shiftKey: boolean) => {
      const {
        selectChatOnly,
        selectChatRange,
        toggleChatSelection,
        lastSelectedChatId: anchor,
      } = useFolderStore.getState()
      if (shiftKey && anchor && anchor !== chatId) {
        selectChatRange(chatIds, anchor, chatId)
      } else if (shiftKey) {
        toggleChatSelection(chatId)
      } else {
        selectChatOnly(chatId)
      }
    },
    [chatIds]
  )

  return {
    selectedChats,
    handleChatClick,
  }
}
