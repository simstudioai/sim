import { useCallback, useEffect, useState } from 'react'
import {
  escapeRegex,
  filterOutContext,
  isContextAlreadySelected,
  SKILL_CHIP_TRIGGER,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

interface UseContextManagementProps {
  /** Current message text */
  message: string
  /** Initial contexts to populate when editing a message */
  initialContexts?: ChatContext[]
}

/**
 * Custom hook to manage selected contexts and their synchronization with mention tokens.
 * Automatically removes contexts when their mention tokens are removed from the message.
 *
 * @param props - Configuration object
 * @returns Context state and management functions
 */
export function useContextManagement({ message, initialContexts }: UseContextManagementProps) {
  const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>(initialContexts ?? [])

  /**
   * Adds a context to the selected contexts list, avoiding duplicates
   * Checks both by specific ID fields and by label to prevent collisions
   *
   * @param context - Context to add
   */
  const addContext = useCallback((context: ChatContext) => {
    setSelectedContexts((prev) => {
      if (isContextAlreadySelected(context, prev)) return prev
      return [...prev, context]
    })
  }, [])

  /**
   * Removes a context from the selected contexts list
   *
   * @param contextToRemove - Context to remove
   */
  const removeContext = useCallback((contextToRemove: ChatContext) => {
    setSelectedContexts((prev) => filterOutContext(prev, contextToRemove))
  }, [])

  /**
   * Clears all selected contexts
   */
  const clearContexts = useCallback(() => {
    setSelectedContexts((prev) => (prev.length === 0 ? prev : []))
  }, [])

  /**
   * Synchronizes selected contexts with inline @label or /label tokens in the message.
   * Removes contexts whose labels are no longer present in the message.
   */
  useEffect(() => {
    if (!message) {
      // Functional updater bails out when already empty; a fresh `[]` literal would
      // emit a new reference and invalidate downstream memos that key on identity.
      setSelectedContexts((prev) => (prev.length === 0 ? prev : []))
      return
    }

    setSelectedContexts((prev) => {
      if (prev.length === 0) return prev

      // Longest label first, masking each token once it matches. One label can be
      // a prefix of another — `notes.md:12` of `notes.md:12-40`, `Sales (3 rows)`
      // of `Sales (3 rows) (2)` — and the lookahead below only rejects a
      // following word character, so `-`, `)` and space all let the shorter
      // pattern match INSIDE the longer token. Without masking, deleting the
      // shorter chip would leave its context attached and still send it.
      const byLabelLengthDesc = [...prev].sort(
        (a, b) => (b.label?.length ?? 0) - (a.label?.length ?? 0)
      )
      let unclaimed = message
      const present = new Set<ChatContext>()

      for (const c of byLabelLengthDesc) {
        if (!c.label) continue
        // The trailing lookahead `(?![A-Za-z0-9_])` accepts any word-boundary
        // — whitespace, end-of-string, or punctuation — so `@Slack.` and
        // `@Slack,` survive the sync. A strict `(\s|$)` here would strip
        // contexts whenever the user ends a sentence with a mention.
        // Skills store a wide EM SPACE sentinel (SKILL_CHIP_TRIGGER) as their
        // trigger so the chip icon fits; slash commands keep '/'; everything
        // else uses '@'. The sentinel is itself a whitespace character, but the
        // `(^|\s)` boundary still matches the (regular) space or start that
        // precedes it, then the literal sentinel.
        const prefix =
          c.kind === 'skill' || c.kind === 'mcp'
            ? SKILL_CHIP_TRIGGER
            : c.kind === 'slash_command'
              ? '/'
              : '@'
        const tokenPattern = new RegExp(
          `(^|\\s)${escapeRegex(prefix)}${escapeRegex(c.label)}(?![A-Za-z0-9_])`
        )
        const match = tokenPattern.exec(unclaimed)
        if (!match) continue
        present.add(c)
        // Blank the claimed span (same length, so later indices stay valid)
        // rather than removing it, keeping the `(^|\s)` boundary intact for
        // whatever sits next to it.
        unclaimed =
          unclaimed.slice(0, match.index) +
          ' '.repeat(match[0].length) +
          unclaimed.slice(match.index + match[0].length)
      }

      const filtered = prev.filter((c) => present.has(c))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [message])

  return {
    selectedContexts,
    setSelectedContexts,
    addContext,
    removeContext,
    clearContexts,
  }
}
