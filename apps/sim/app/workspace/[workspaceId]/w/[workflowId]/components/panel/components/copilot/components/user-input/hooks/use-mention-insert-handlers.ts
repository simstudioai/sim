import { useCallback, useMemo } from 'react'
import type { MentionFolderNav } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components'
import {
  DOCS_CONFIG,
  FOLDER_CONFIGS,
  type FolderConfig,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import type { useMentionMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-menu'
import { isContextAlreadySelected } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

interface UseMentionInsertHandlersProps {
  /** Mention menu hook instance */
  mentionMenu: ReturnType<typeof useMentionMenu>
  /** Current workflow ID */
  workflowId: string | null
  /** Currently selected contexts */
  selectedContexts: ChatContext[]
  /** Callback to update selected contexts */
  onContextAdd: (context: ChatContext) => void
  /** Folder navigation state exposed from MentionMenu via callback */
  mentionFolderNav?: MentionFolderNav | null
}

/**
 * Custom hook to provide insert handlers for different mention types.
 *
 * @param props - Configuration object
 * @returns Insert handler functions for each mention type
 */
export function useMentionInsertHandlers({
  mentionMenu,
  workflowId,
  selectedContexts,
  onContextAdd,
  mentionFolderNav,
}: UseMentionInsertHandlersProps) {
  const {
    replaceActiveMentionWith,
    insertAtCursor,
    setShowMentionMenu,
    setOpenSubmenuFor,
    resetActiveMentionQuery,
  } = mentionMenu

  /**
   * Closes all menus and resets state
   */
  const closeMenus = useCallback(() => {
    setShowMentionMenu(false)
    if (mentionFolderNav?.isInFolder) {
      mentionFolderNav.closeFolder()
    }
    setOpenSubmenuFor(null)
  }, [setShowMentionMenu, setOpenSubmenuFor, mentionFolderNav])

  const createInsertHandler = useCallback(
    <TItem>(config: FolderConfig<TItem>) => {
      return (item: TItem) => {
        const label = config.getLabel(item)
        const context = config.buildContext(item, workflowId)

        if (isContextAlreadySelected(context, selectedContexts)) {
          resetActiveMentionQuery()
          closeMenus()
          return
        }

        if (config.useInsertFallback) {
          if (!replaceActiveMentionWith(label)) {
            insertAtCursor(` @${label} `)
          }
        } else {
          replaceActiveMentionWith(label)
        }

        onContextAdd(context)
        closeMenus()
      }
    },
    [
      workflowId,
      selectedContexts,
      replaceActiveMentionWith,
      insertAtCursor,
      onContextAdd,
      resetActiveMentionQuery,
      closeMenus,
    ]
  )

  /**
   * Special handler for Docs (no item parameter, uses DOCS_CONFIG)
   */
  const insertDocsMention = useCallback(() => {
    const label = DOCS_CONFIG.getLabel()
    const context = DOCS_CONFIG.buildContext()

    // Prevent duplicate insertion
    if (isContextAlreadySelected(context, selectedContexts)) {
      resetActiveMentionQuery()
      closeMenus()
      return
    }

    // Docs uses fallback insertion
    if (!replaceActiveMentionWith(label)) {
      insertAtCursor(` @${label} `)
    }

    onContextAdd(context)
    closeMenus()
  }, [
    selectedContexts,
    replaceActiveMentionWith,
    insertAtCursor,
    onContextAdd,
    resetActiveMentionQuery,
    closeMenus,
  ])

  const handlers = useMemo(
    () => ({
      insertPastChatMention: createInsertHandler(FOLDER_CONFIGS.chats),
      insertWorkflowMention: createInsertHandler(FOLDER_CONFIGS.workflows),
      insertKnowledgeMention: createInsertHandler(FOLDER_CONFIGS.knowledge),
      insertBlockMention: createInsertHandler(FOLDER_CONFIGS.blocks),
      insertWorkflowBlockMention: createInsertHandler(FOLDER_CONFIGS['workflow-blocks']),
      insertTemplateMention: createInsertHandler(FOLDER_CONFIGS.templates),
      insertLogMention: createInsertHandler(FOLDER_CONFIGS.logs),
      insertDocsMention,
    }),
    [createInsertHandler, insertDocsMention]
  )

  return handlers
}
