import { useCallback } from 'react'
import type { ChatContext } from '@/stores/panel-new/copilot/types'
import type { useMentionMenu } from './use-mention-menu'

interface UseMentionTokensProps {
  /** Current message text */
  message: string
  /** Currently selected contexts */
  selectedContexts: ChatContext[]
  /** Mention menu hook instance */
  mentionMenu: ReturnType<typeof useMentionMenu>
  /** Callback to update message */
  setMessage: (message: string) => void
  /** Callback to update selected contexts */
  setSelectedContexts: React.Dispatch<React.SetStateAction<ChatContext[]>>
}

/**
 * Represents a mention token range in the message text
 */
export interface MentionRange {
  start: number
  end: number
  label: string
}

/**
 * Custom hook to manage mention token ranges and manipulation.
 * Handles computing mention ranges, deleting tokens, and preventing editing inside tokens.
 *
 * @param props - Configuration object
 * @returns Mention token utilities
 */
export function useMentionTokens({
  message,
  selectedContexts,
  mentionMenu,
  setMessage,
  setSelectedContexts,
}: UseMentionTokensProps) {
  /**
   * Computes all mention ranges in the message
   *
   * @returns Array of mention ranges sorted by start position
   */
  const computeMentionRanges = useCallback((): MentionRange[] => {
    const ranges: MentionRange[] = []
    if (!message || selectedContexts.length === 0) return ranges

    const labels = selectedContexts.map((c) => c.label).filter(Boolean)
    if (labels.length === 0) return ranges

    // Deduplicate labels to avoid finding the same token multiple times
    // when multiple contexts share the same label
    const uniqueLabels = Array.from(new Set(labels))

    for (const label of uniqueLabels) {
      // Space-wrapped token: " @label " (search from start)
      const token = ` @${label} `
      let fromIndex = 0
      while (fromIndex <= message.length) {
        const idx = message.indexOf(token, fromIndex)
        if (idx === -1) break
        // Include both leading and trailing spaces in the range
        ranges.push({ start: idx, end: idx + token.length, label })
        fromIndex = idx + token.length
      }
    }

    ranges.sort((a, b) => a.start - b.start)
    return ranges
  }, [message, selectedContexts])

  /**
   * Finds a mention range containing the given position
   *
   * @param pos - Position to check
   * @returns Mention range if found, undefined otherwise
   */
  const findRangeContaining = useCallback(
    (pos: number): MentionRange | undefined => {
      const ranges = computeMentionRanges()
      return ranges.find((r) => pos > r.start && pos < r.end)
    },
    [computeMentionRanges]
  )

  /**
   * Removes contexts for mention tokens that overlap with a text selection
   *
   * @param selStart - Selection start position
   * @param selEnd - Selection end position
   */
  const removeContextsInSelection = useCallback(
    (selStart: number, selEnd: number) => {
      const ranges = computeMentionRanges()
      const overlappingRanges = ranges.filter((r) => !(selEnd <= r.start || selStart >= r.end))

      if (overlappingRanges.length > 0) {
        const labelsToRemove = new Set(overlappingRanges.map((r) => r.label))
        setSelectedContexts((prev) => prev.filter((c) => !c.label || !labelsToRemove.has(c.label)))
      }
    },
    [computeMentionRanges, setSelectedContexts]
  )

  /**
   * Deletes a single mention range and its context (for atomic token deletion)
   *
   * @param range - The range to delete
   */
  const deleteRange = useCallback(
    (range: MentionRange) => {
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return

      const before = message.slice(0, range.start)
      const after = message.slice(range.end)
      const next = `${before}${after}`.replace(/\s{2,}/g, ' ')
      setMessage(next)

      setSelectedContexts((prev) => prev.filter((c) => c.label !== range.label))

      // Set cursor position immediately after state update
      setTimeout(() => {
        textarea.setSelectionRange(range.start, range.start)
        textarea.focus()
      }, 0)
    },
    [message, setMessage, mentionMenu.textareaRef, setSelectedContexts]
  )

  /**
   * Handles cut operations to remove contexts for cut mention tokens
   *
   * @param e - Clipboard event
   */
  const handleCut = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return

      const selStart = textarea.selectionStart ?? 0
      const selEnd = textarea.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      if (selectionLength > 0) {
        removeContextsInSelection(selStart, selEnd)
      }
    },
    [mentionMenu.textareaRef, removeContextsInSelection]
  )

  return {
    computeMentionRanges,
    findRangeContaining,
    removeContextsInSelection,
    deleteRange,
    handleCut,
  }
}
