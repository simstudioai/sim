'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { CopilotMessage } from '@/stores/panel-new/copilot/types'

const logger = createLogger('useMessageEditing')

/**
 * Message truncation height in pixels
 */
const MESSAGE_TRUNCATION_HEIGHT = 60

/**
 * Delay before attaching click-outside listener to avoid immediate trigger
 */
const CLICK_OUTSIDE_DELAY = 100

/**
 * Delay before aborting when editing during stream
 */
const ABORT_DELAY = 100

interface UseMessageEditingProps {
  message: CopilotMessage
  messages: CopilotMessage[]
  isLastUserMessage: boolean
  hasCheckpoints: boolean
  onEditModeChange?: (isEditing: boolean) => void
  showCheckpointDiscardModal: boolean
  setShowCheckpointDiscardModal: (show: boolean) => void
  pendingEditRef: React.MutableRefObject<{
    message: string
    fileAttachments?: any[]
    contexts?: any[]
  } | null>
  /**
   * When true, disables the internal document click-outside handler.
   * Use when a parent component provides its own click-outside handling.
   */
  disableDocumentClickOutside?: boolean
}

/**
 * Custom hook to manage message editing functionality
 * Handles edit mode state, expansion, click handlers, and edit submission
 *
 * @param props - Message editing configuration
 * @returns Message editing state and handlers
 */
export function useMessageEditing(props: UseMessageEditingProps) {
  const {
    message,
    messages,
    isLastUserMessage,
    hasCheckpoints,
    onEditModeChange,
    showCheckpointDiscardModal,
    setShowCheckpointDiscardModal,
    pendingEditRef,
    disableDocumentClickOutside = false,
  } = props

  const [isEditMode, setIsEditMode] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [editedContent, setEditedContent] = useState(message.content)
  const [needsExpansion, setNeedsExpansion] = useState(false)

  const editContainerRef = useRef<HTMLDivElement>(null)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const userInputRef = useRef<any>(null)

  const { sendMessage, isSendingMessage, abortMessage, currentChat } = useCopilotStore()

  /**
   * Checks if message content needs expansion based on height
   */
  useEffect(() => {
    if (messageContentRef.current && message.role === 'user') {
      const scrollHeight = messageContentRef.current.scrollHeight
      setNeedsExpansion(scrollHeight > MESSAGE_TRUNCATION_HEIGHT)
    }
  }, [message.content, message.role])

  /**
   * Handles entering edit mode
   */
  const handleEditMessage = useCallback(() => {
    setIsEditMode(true)
    setIsExpanded(false)
    setEditedContent(message.content)
    onEditModeChange?.(true)

    setTimeout(() => {
      userInputRef.current?.focus()
    }, 0)
  }, [message.content, onEditModeChange])

  /**
   * Handles canceling edit mode
   */
  const handleCancelEdit = useCallback(() => {
    setIsEditMode(false)
    setEditedContent(message.content)
    onEditModeChange?.(false)
  }, [message.content, onEditModeChange])

  /**
   * Handles clicking on message to enter edit mode
   */
  const handleMessageClick = useCallback(() => {
    if (needsExpansion && !isExpanded) {
      setIsExpanded(true)
    }
    handleEditMessage()
  }, [needsExpansion, isExpanded, handleEditMessage])

  /**
   * Performs the actual edit operation
   * Truncates messages after edited message and resends with same ID
   */
  const performEdit = useCallback(
    async (editedMessage: string, fileAttachments?: any[], contexts?: any[]) => {
      const currentMessages = messages
      const editIndex = currentMessages.findIndex((m) => m.id === message.id)

      if (editIndex !== -1) {
        setIsEditMode(false)
        onEditModeChange?.(false)

        const truncatedMessages = currentMessages.slice(0, editIndex)
        const updatedMessage = {
          ...message,
          content: editedMessage,
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
        }

        useCopilotStore.setState({ messages: [...truncatedMessages, updatedMessage] })

        if (currentChat?.id) {
          try {
            await fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId: currentChat.id,
                messages: truncatedMessages.map((m) => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  ...(m.contentBlocks && { contentBlocks: m.contentBlocks }),
                  ...(m.fileAttachments && { fileAttachments: m.fileAttachments }),
                  ...((m as any).contexts && { contexts: (m as any).contexts }),
                })),
              }),
            })
          } catch (error) {
            logger.error('Failed to update messages in DB after edit:', error)
          }
        }

        await sendMessage(editedMessage, {
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
          messageId: message.id,
        })
      }
    },
    [messages, message, currentChat, sendMessage, onEditModeChange]
  )

  /**
   * Handles submitting edited message
   * Checks for checkpoints and shows confirmation if needed
   */
  const handleSubmitEdit = useCallback(
    async (editedMessage: string, fileAttachments?: any[], contexts?: any[]) => {
      if (!editedMessage.trim()) return

      if (isSendingMessage) {
        abortMessage()
        await new Promise((resolve) => setTimeout(resolve, ABORT_DELAY))
      }

      if (hasCheckpoints) {
        pendingEditRef.current = { message: editedMessage, fileAttachments, contexts }
        setShowCheckpointDiscardModal(true)
        return
      }

      await performEdit(editedMessage, fileAttachments, contexts)
    },
    [
      isSendingMessage,
      hasCheckpoints,
      abortMessage,
      performEdit,
      pendingEditRef,
      setShowCheckpointDiscardModal,
    ]
  )

  /**
   * Keyboard-only exit (Esc). Click-outside is optionally handled by parent.
   */
  useEffect(() => {
    if (!isEditMode) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancelEdit()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isEditMode, handleCancelEdit])

  /**
   * Optional document-level click-outside handler (disabled when parent manages it).
   */
  useEffect(() => {
    if (!isEditMode || disableDocumentClickOutside) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (editContainerRef.current?.contains(target)) {
        return
      }
      handleCancelEdit()
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside, true)
    }, CLICK_OUTSIDE_DELAY)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside, true)
    }
  }, [isEditMode, disableDocumentClickOutside, handleCancelEdit])

  return {
    // State
    isEditMode,
    isExpanded,
    editedContent,
    needsExpansion,

    // Refs
    editContainerRef,
    messageContentRef,
    userInputRef,

    // Operations
    setEditedContent,
    handleCancelEdit,
    handleMessageClick,
    handleSubmitEdit,
  }
}
