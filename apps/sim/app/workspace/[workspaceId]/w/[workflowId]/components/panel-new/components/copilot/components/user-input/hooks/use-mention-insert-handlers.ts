import { useCallback } from 'react'
import type { ChatContext } from '@/stores/panel-new/copilot/types'
import type { useMentionMenu } from './use-mention-menu'

interface UseMentionInsertHandlersProps {
  /** Mention menu hook instance */
  mentionMenu: ReturnType<typeof useMentionMenu>
  /** Current workflow ID */
  workflowId: string | null
  /** Currently selected contexts */
  selectedContexts: ChatContext[]
  /** Callback to update selected contexts */
  onContextAdd: (context: ChatContext) => void
}

/**
 * Custom hook to provide insert handlers for different mention types.
 * Consolidates the logic for inserting mentions and updating selected contexts.
 * Prevents duplicate mentions from being inserted.
 *
 * @param props - Configuration object
 * @returns Insert handler functions for each mention type
 */
export function useMentionInsertHandlers({
  mentionMenu,
  workflowId,
  selectedContexts,
  onContextAdd,
}: UseMentionInsertHandlersProps) {
  const {
    replaceActiveMentionWith,
    insertAtCursor,
    setShowMentionMenu,
    setOpenSubmenuFor,
    resetActiveMentionQuery,
  } = mentionMenu

  /**
   * Checks if a context already exists in selected contexts
   * CRITICAL: Prioritizes label checking to prevent token system breakage
   *
   * @param context - Context to check
   * @returns True if context already exists or label is already used
   */
  const isContextAlreadySelected = useCallback(
    (context: ChatContext): boolean => {
      return selectedContexts.some((c) => {
        // CRITICAL: Check label collision FIRST
        // The token system uses @label format, so we cannot have duplicate labels
        // regardless of kind or ID differences
        if (c.label && context.label && c.label === context.label) {
          return true
        }

        // Secondary check: exact duplicate by ID fields
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
            return true
          }
        }

        return false
      })
    },
    [selectedContexts]
  )

  /**
   * Inserts a past chat mention
   *
   * @param chat - Chat object to mention
   */
  const insertPastChatMention = useCallback(
    (chat: { id: string; title: string | null }) => {
      const label = chat.title || 'New Chat'
      const context = { kind: 'past_chat', chatId: chat.id, label } as ChatContext

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text (e.g., "@Unti") before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      replaceActiveMentionWith(label)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a workflow mention
   *
   * @param wf - Workflow object to mention
   */
  const insertWorkflowMention = useCallback(
    (wf: { id: string; name: string }) => {
      const label = wf.name || 'Untitled Workflow'
      const context = { kind: 'workflow', workflowId: wf.id, label } as ChatContext

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      if (!replaceActiveMentionWith(label)) insertAtCursor(` @${label} `)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      insertAtCursor,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a knowledge base mention
   *
   * @param kb - Knowledge base object to mention
   */
  const insertKnowledgeMention = useCallback(
    (kb: { id: string; name: string }) => {
      const label = kb.name || 'Untitled'
      const context = { kind: 'knowledge', knowledgeId: kb.id, label } as any

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      replaceActiveMentionWith(label)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a block mention
   *
   * @param blk - Block object to mention
   */
  const insertBlockMention = useCallback(
    (blk: { id: string; name: string }) => {
      const label = blk.name || blk.id
      const context = { kind: 'blocks', blockId: blk.id, label } as any

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      replaceActiveMentionWith(label)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a workflow block mention
   *
   * @param blk - Workflow block object to mention
   */
  const insertWorkflowBlockMention = useCallback(
    (blk: { id: string; name: string }) => {
      const label = blk.name
      const context = {
        kind: 'workflow_block',
        workflowId: workflowId as string,
        blockId: blk.id,
        label,
      } as any

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      if (!replaceActiveMentionWith(label)) insertAtCursor(` @${label} `)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      insertAtCursor,
      workflowId,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a template mention
   *
   * @param tpl - Template object to mention
   */
  const insertTemplateMention = useCallback(
    (tpl: { id: string; name: string }) => {
      const label = tpl.name || 'Untitled Template'
      const context = { kind: 'templates', templateId: tpl.id, label } as any

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      replaceActiveMentionWith(label)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a log mention
   *
   * @param log - Log object to mention
   */
  const insertLogMention = useCallback(
    (log: { id: string; executionId?: string; workflowName: string }) => {
      const label = log.workflowName
      const context = { kind: 'logs' as const, executionId: log.executionId, label }

      // Prevent duplicate insertion
      if (isContextAlreadySelected(context)) {
        // Clear the partial mention text before closing
        resetActiveMentionQuery()
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }

      replaceActiveMentionWith(label)
      onContextAdd(context)
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    },
    [
      replaceActiveMentionWith,
      onContextAdd,
      setShowMentionMenu,
      setOpenSubmenuFor,
      isContextAlreadySelected,
      resetActiveMentionQuery,
    ]
  )

  /**
   * Inserts a docs mention
   */
  const insertDocsMention = useCallback(() => {
    const label = 'Docs'
    const context = { kind: 'docs', label } as any

    // Prevent duplicate insertion
    if (isContextAlreadySelected(context)) {
      // Clear the partial mention text before closing
      resetActiveMentionQuery()
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
      return
    }

    if (!replaceActiveMentionWith(label)) insertAtCursor(` @${label} `)
    onContextAdd(context)
    setShowMentionMenu(false)
    setOpenSubmenuFor(null)
  }, [
    replaceActiveMentionWith,
    insertAtCursor,
    onContextAdd,
    setShowMentionMenu,
    setOpenSubmenuFor,
    isContextAlreadySelected,
    resetActiveMentionQuery,
  ])

  return {
    insertPastChatMention,
    insertWorkflowMention,
    insertKnowledgeMention,
    insertBlockMention,
    insertWorkflowBlockMention,
    insertTemplateMention,
    insertLogMention,
    insertDocsMention,
  }
}
