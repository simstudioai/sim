import type { MentionFolderNav } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components'
import { useContextManagement } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-context-management'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { useMentionData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-data'
import { useMentionInsertHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-insert-handlers'
import { useMentionKeyboard } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-keyboard'
import { useMentionMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-menu'
import { useMentionTokens } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-tokens'
import { useTextareaAutoResize } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-textarea-auto-resize'
import type { ChatContext } from '@/stores/panel'

interface UseMentionSystemProps {
  message: string
  setMessage: (message: string) => void
  workflowId: string | null
  workspaceId: string
  userId?: string
  panelWidth: number
  disabled: boolean
  isLoading: boolean
  inputContainerRef: HTMLDivElement | null
  initialContexts?: ChatContext[]
  mentionFolderNav: MentionFolderNav | null
}

/**
 * Composite hook that combines all mention-related hooks into a single interface.
 * Reduces import complexity in components that need full mention functionality.
 *
 * @param props - Configuration for all mention system hooks
 * @returns Combined interface for mention system functionality
 */
export function useMentionSystem({
  message,
  setMessage,
  workflowId,
  workspaceId,
  userId,
  panelWidth,
  disabled,
  isLoading,
  inputContainerRef,
  initialContexts,
  mentionFolderNav,
}: UseMentionSystemProps) {
  const contextManagement = useContextManagement({ message, initialContexts })

  const mentionMenu = useMentionMenu({
    message,
    selectedContexts: contextManagement.selectedContexts,
    onContextSelect: contextManagement.addContext,
    onMessageChange: setMessage,
  })

  const mentionTokens = useMentionTokens({
    message,
    selectedContexts: contextManagement.selectedContexts,
    mentionMenu,
    setMessage,
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  const { overlayRef } = useTextareaAutoResize({
    message,
    panelWidth,
    selectedContexts: contextManagement.selectedContexts,
    textareaRef: mentionMenu.textareaRef,
    containerRef: inputContainerRef,
  })

  const mentionData = useMentionData({
    workflowId,
    workspaceId,
  })

  const fileAttachments = useFileAttachments({
    userId,
    disabled,
    isLoading,
  })

  const insertHandlers = useMentionInsertHandlers({
    mentionMenu,
    workflowId,
    selectedContexts: contextManagement.selectedContexts,
    onContextAdd: contextManagement.addContext,
    mentionFolderNav,
  })

  const mentionKeyboard = useMentionKeyboard({
    mentionMenu,
    mentionData,
    insertHandlers,
    mentionFolderNav,
  })

  return {
    contextManagement,
    mentionMenu,
    mentionTokens,
    overlayRef,
    mentionData,
    fileAttachments,
    insertHandlers,
    mentionKeyboard,
  }
}
