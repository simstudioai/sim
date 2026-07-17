import { useCallback, useMemo } from 'react'
import type { useMentionMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-menu'
import { SKILL_CHIP_TRIGGER } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
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
 * Custom hook for the TEXT side of mention tokens: computing token ranges,
 * locating the range at a caret, and deleting a token's text atomically.
 *
 * Context lifetime is intentionally NOT managed here — `useContextManagement`'s
 * sync effect owns it, removing a context exactly when its last matching token
 * disappears from the message. That keeps duplicate-label chips (two `@sub` for
 * the same resource) correct: deleting one token leaves the other, so the
 * shared context survives.
 *
 * @param props - Configuration object
 * @returns Mention token text utilities
 */
export function useMentionTokens({
  message,
  selectedContexts,
  mentionMenu,
  setMessage,
}: UseMentionTokensProps) {
  /**
   * All mention token ranges in the message, recomputed only when the message or
   * selected contexts change — so the O(n×m) scan never runs on every keystroke.
   */
  const mentionRanges = useMemo((): MentionRange[] => {
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
      const prefix =
        matchingContext?.kind === 'skill'
          ? SKILL_CHIP_TRIGGER
          : matchingContext?.kind === 'slash_command'
            ? '/'
            : '@'

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
   * Finds the mention range strictly containing a caret position, if any.
   *
   * @param pos - Caret position to check
   * @returns The containing range, or `undefined`
   */
  const findRangeContaining = useCallback(
    (pos: number): MentionRange | undefined => {
      return mentionRanges.find((r) => pos > r.start && pos < r.end)
    },
    [mentionRanges]
  )

  /**
   * Atomically deletes a single mention token's text. The context is left to
   * `useContextManagement`'s sync effect, which prunes it only once no matching
   * token remains — so deleting one of two duplicate chips keeps the other.
   *
   * @param range - The range to delete
   */
  const deleteRange = useCallback(
    (range: MentionRange) => {
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return

      const before = message.slice(0, range.start)
      const after = message.slice(range.end)
      // Collapse only the space seam the removal creates (a leading + trailing
      // space meeting), never unrelated double-spaces elsewhere in the message —
      // by extending the deleted range over those leading spaces so the whole
      // removal is a single edit.
      const deleteEnd =
        before.endsWith(' ') && after.startsWith(' ')
          ? range.end + (after.length - after.replace(/^ +/, '').length)
          : range.end

      // Prefer `execCommand` (deprecated, but the only primitive that lands the
      // removal on the native undo stack, so Cmd+Z restores the chip). It's a
      // no-op on Firefox textareas and returns false there, so fall back to a
      // direct edit — correct deletion, just no native undo on that browser.
      textarea.focus()
      textarea.setSelectionRange(range.start, deleteEnd)
      const valueBeforeDelete = textarea.value
      if (!document.execCommand('delete') || textarea.value === valueBeforeDelete) {
        textarea.setRangeText('', range.start, deleteEnd, 'start')
      }

      // The edit fires `input`, but sync state explicitly so this hook doesn't
      // depend on the consumer's onChange wiring.
      setMessage(textarea.value)

      setTimeout(() => {
        textarea.setSelectionRange(range.start, range.start)
        textarea.focus()
      }, 0)
    },
    [message, setMessage, mentionMenu.textareaRef]
  )

  return {
    mentionRanges,
    findRangeContaining,
    deleteRange,
  }
}
