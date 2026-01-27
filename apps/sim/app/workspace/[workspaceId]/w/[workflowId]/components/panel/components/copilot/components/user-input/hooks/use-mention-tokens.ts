import { useCallback, useMemo } from 'react'
import type { useMentionMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-menu'
import type { ChatContext } from '@/stores/panel'

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
   * Memoized mention ranges - computed once when message or selectedContexts change.
   * This prevents expensive O(n×m) string searches from running on every keystroke
   * when other callbacks access the ranges.
   */
  const memoizedMentionRanges = useMemo((): MentionRange[] => {
    const ranges: MentionRange[] = []
    if (!message || selectedContexts.length === 0) return ranges

    const labels = selectedContexts.map((c) => c.label).filter(Boolean)
    if (labels.length === 0) return ranges

    // Deduplicate labels to avoid finding the same token multiple times
    // when multiple contexts share the same label
    const uniqueLabels = Array.from(new Set(labels))

    for (const label of uniqueLabels) {
      // Find matching context to determine if it's a slash command
      const matchingContext = selectedContexts.find((c) => c.label === label)
      const isSlashCommand = matchingContext?.kind === 'slash_command'
      const prefix = isSlashCommand ? '/' : '@'

      // Check for token at the very start of the message (no leading space)
      const tokenAtStart = `${prefix}${label} `
      if (message.startsWith(tokenAtStart)) {
        ranges.push({ start: 0, end: tokenAtStart.length, label })
      }

      // Space-wrapped token: " @label " or " /label " (search from start)
      const token = ` ${prefix}${label} `
      let fromIndex = 0
      while (fromIndex <= message.length) {
        const idx = message.indexOf(token, fromIndex)
        if (idx === -1) break
        // Include both leading and trailing spaces in the range
        ranges.push({ start: idx, end: idx + token.length, label })
        fromIndex = idx + token.length
      }

      // Token at end of message without trailing space: "@label" or " /label"
      const tokenAtEnd = `${prefix}${label}`
      if (message.endsWith(tokenAtEnd)) {
        const idx = message.lastIndexOf(tokenAtEnd)
        const hasLeadingSpace = idx > 0 && message[idx - 1] === ' '
        const start = hasLeadingSpace ? idx - 1 : idx
        ranges.push({ start, end: message.length, label })
      }
    }

    ranges.sort((a, b) => a.start - b.start)
    return ranges
  }, [message, selectedContexts])

  /**
   * Finds a mention range containing the given position
   */
  const computeMentionRanges = useCallback(
    (): MentionRange[] => memoizedMentionRanges,
    [memoizedMentionRanges]
  )

  /**
   * Finds a mention range containing the given position.
   * Uses memoized ranges directly for better performance.
   *
   * @param pos - Position to check
   * @returns Mention range if found, undefined otherwise
   */
  const findRangeContaining = useCallback(
    (pos: number): MentionRange | undefined => {
      return memoizedMentionRanges.find((r) => pos > r.start && pos < r.end)
    },
    [memoizedMentionRanges]
  )

  /**
   * Removes contexts for mention tokens that overlap with a text selection.
   * Uses memoized ranges directly for better performance.
   *
   * @param selStart - Selection start position
   * @param selEnd - Selection end position
   */
  const removeContextsInSelection = useCallback(
    (selStart: number, selEnd: number) => {
      const overlappingRanges = memoizedMentionRanges.filter(
        (r) => !(selEnd <= r.start || selStart >= r.end)
      )

      if (overlappingRanges.length > 0) {
        const labelsToRemove = new Set(overlappingRanges.map((r) => r.label))
        setSelectedContexts((prev) => prev.filter((c) => !c.label || !labelsToRemove.has(c.label)))
      }
    },
    [memoizedMentionRanges, setSelectedContexts]
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
