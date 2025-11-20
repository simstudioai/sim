import { useCallback, useEffect, useState } from 'react'
import type { ChatContext } from '@/stores/panel-new/copilot/types'

interface UseContextManagementProps {
  /** Current message text */
  message: string
}

/**
 * Custom hook to manage selected contexts and their synchronization with mention tokens.
 * Automatically removes contexts when their mention tokens are removed from the message.
 *
 * @param props - Configuration object
 * @returns Context state and management functions
 */
export function useContextManagement({ message }: UseContextManagementProps) {
  const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>([])

  /**
   * Adds a context to the selected contexts list, avoiding duplicates
   * Checks both by specific ID fields and by label to prevent collisions
   *
   * @param context - Context to add
   */
  const addContext = useCallback((context: ChatContext) => {
    setSelectedContexts((prev) => {
      // CRITICAL: Check label collision FIRST
      // The token system uses @label format, so we cannot have duplicate labels
      // regardless of kind or ID differences
      const exists = prev.some((c) => {
        // Primary check: label collision
        // This prevents duplicate @Label tokens which would break the overlay
        if (c.label && context.label && c.label === context.label) {
          return true
        }

        // Secondary check: exact duplicate by ID fields based on kind
        // This prevents the same entity from being added twice even with different labels
        if (c.kind === context.kind) {
          if (c.kind === 'past_chat' && 'chatId' in context && 'chatId' in c) {
            return c.chatId === (context as any).chatId
          }
          if (c.kind === 'workflow' && 'workflowId' in context && 'workflowId' in c) {
            return c.workflowId === (context as any).workflowId
          }
          if (c.kind === 'blocks' && 'blockId' in context && 'blockId' in c) {
            return c.blockId === (context as any).blockId
          }
          if (c.kind === 'workflow_block' && 'blockId' in context && 'blockId' in c) {
            return (
              c.workflowId === (context as any).workflowId && c.blockId === (context as any).blockId
            )
          }
          if (c.kind === 'knowledge' && 'knowledgeId' in context && 'knowledgeId' in c) {
            return c.knowledgeId === (context as any).knowledgeId
          }
          if (c.kind === 'templates' && 'templateId' in context && 'templateId' in c) {
            return c.templateId === (context as any).templateId
          }
          if (c.kind === 'logs' && 'executionId' in context && 'executionId' in c) {
            return c.executionId === (context as any).executionId
          }
          if (c.kind === 'docs') {
            return true // Only one docs context allowed
          }
        }

        return false
      })
      if (exists) return prev
      return [...prev, context]
    })
  }, [])

  /**
   * Removes a context from the selected contexts list
   *
   * @param contextToRemove - Context to remove
   */
  const removeContext = useCallback((contextToRemove: ChatContext) => {
    setSelectedContexts((prev) =>
      prev.filter((c) => {
        // Match by kind and specific ID fields
        if (c.kind !== contextToRemove.kind) return true

        switch (c.kind) {
          case 'past_chat':
            return (c as any).chatId !== (contextToRemove as any).chatId
          case 'workflow':
            return (c as any).workflowId !== (contextToRemove as any).workflowId
          case 'blocks':
            return (c as any).blockId !== (contextToRemove as any).blockId
          case 'workflow_block':
            return (
              (c as any).workflowId !== (contextToRemove as any).workflowId ||
              (c as any).blockId !== (contextToRemove as any).blockId
            )
          case 'knowledge':
            return (c as any).knowledgeId !== (contextToRemove as any).knowledgeId
          case 'templates':
            return (c as any).templateId !== (contextToRemove as any).templateId
          case 'logs':
            return (c as any).executionId !== (contextToRemove as any).executionId
          case 'docs':
            return false // Remove docs (only one docs context)
          default:
            return c.label !== contextToRemove.label
        }
      })
    )
  }, [])

  /**
   * Clears all selected contexts
   */
  const clearContexts = useCallback(() => {
    setSelectedContexts([])
  }, [])

  /**
   * Synchronizes selected contexts with inline @label tokens in the message.
   * Removes contexts whose labels are no longer present in the message.
   */
  useEffect(() => {
    if (!message) {
      setSelectedContexts([])
      return
    }

    setSelectedContexts((prev) => {
      if (prev.length === 0) return prev

      const presentLabels = new Set<string>()
      const labels = prev.map((c) => c.label).filter(Boolean)

      for (const label of labels) {
        const token = ` @${label} `
        if (message.includes(token)) {
          presentLabels.add(label)
        }
      }

      const filtered = prev.filter((c) => !!c.label && presentLabels.has(c.label))
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
