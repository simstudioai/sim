import { useCallback, useState } from 'react'
import {
  filterContextsPresentInMessage,
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
  const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>(() =>
    filterContextsPresentInMessage(initialContexts ?? [], message)
  )
  const [prunedForMessage, setPrunedForMessage] = useState(message)

  /**
   * Drops contexts whose inline @label or /label token left the message, during
   * render. An effect here re-rendered after every keystroke; when keystrokes
   * outpace React's scheduler (a loaded machine), React counts those commits as
   * nested updates and the next `setState` (the Enter that submits) throws
   * "Maximum update depth exceeded".
   */
  if (prunedForMessage !== message) {
    setPrunedForMessage(message)
    const present = filterContextsPresentInMessage(selectedContexts, message)
    if (present !== selectedContexts) setSelectedContexts(present)
  }

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

  return {
    selectedContexts,
    setSelectedContexts,
    addContext,
    removeContext,
    clearContexts,
  }
}
