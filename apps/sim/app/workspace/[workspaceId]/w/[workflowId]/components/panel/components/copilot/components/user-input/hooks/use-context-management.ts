import { useCallback, useEffect, useRef, useState } from 'react'
import {
  escapeRegex,
  filterOutContext,
  isContextAlreadySelected,
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
  const initializedRef = useRef(false)

  // Initialize with initial contexts when they're first provided (for edit mode)
  useEffect(() => {
    if (initialContexts && initialContexts.length > 0 && !initializedRef.current) {
      setSelectedContexts(initialContexts)
      initializedRef.current = true
    }
  }, [initialContexts])

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
    setSelectedContexts([])
  }, [])

  /**
   * Synchronizes selected contexts with inline @label or /label tokens in the message.
   * Removes contexts whose labels are no longer present in the message.
   */
  useEffect(() => {
    if (!message) {
      setSelectedContexts([])
      return
    }

    setSelectedContexts((prev) => {
      if (prev.length === 0) return prev

      const filtered = prev.filter((c) => {
        if (!c.label) return false
        // Check for slash command tokens or mention tokens based on kind
        const isSlashCommand = c.kind === 'slash_command'
        const prefix = isSlashCommand ? '/' : '@'
        const tokenPattern = new RegExp(
          `(^|\\s)${escapeRegex(prefix)}${escapeRegex(c.label)}(\\s|$)`
        )
        return tokenPattern.test(message)
      })
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
