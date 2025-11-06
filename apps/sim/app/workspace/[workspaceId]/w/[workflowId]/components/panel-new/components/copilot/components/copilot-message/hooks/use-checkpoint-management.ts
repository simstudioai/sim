'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { CopilotMessage } from '@/stores/panel-new/copilot/types'

const logger = createLogger('useCheckpointManagement')

/**
 * Custom hook to handle checkpoint-related operations for messages
 *
 * @param message - The copilot message
 * @param messages - Array of all messages in the chat
 * @param messageCheckpoints - Checkpoints for this message
 * @param onRevertModeChange - Callback for revert mode changes
 * @param onEditModeChange - Callback for edit mode changes
 * @returns Checkpoint management utilities
 */
export function useCheckpointManagement(
  message: CopilotMessage,
  messages: CopilotMessage[],
  messageCheckpoints: any[],
  onRevertModeChange?: (isReverting: boolean) => void,
  onEditModeChange?: (isEditing: boolean) => void
) {
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false)
  const [showCheckpointDiscardModal, setShowCheckpointDiscardModal] = useState(false)
  const pendingEditRef = useRef<{
    message: string
    fileAttachments?: any[]
    contexts?: any[]
  } | null>(null)

  const { revertToCheckpoint, currentChat } = useCopilotStore()

  /**
   * Handles initiating checkpoint revert
   */
  const handleRevertToCheckpoint = useCallback(() => {
    setShowRestoreConfirmation(true)
    onRevertModeChange?.(true)
  }, [onRevertModeChange])

  /**
   * Confirms checkpoint revert and updates state
   */
  const handleConfirmRevert = useCallback(async () => {
    if (messageCheckpoints.length > 0) {
      const latestCheckpoint = messageCheckpoints[0]
      try {
        await revertToCheckpoint(latestCheckpoint.id)

        const { messageCheckpoints: currentCheckpoints } = useCopilotStore.getState()
        const updatedCheckpoints = {
          ...currentCheckpoints,
          [message.id]: messageCheckpoints.slice(1),
        }
        useCopilotStore.setState({ messageCheckpoints: updatedCheckpoints })

        const currentMessages = messages
        const revertIndex = currentMessages.findIndex((m) => m.id === message.id)
        if (revertIndex !== -1) {
          const truncatedMessages = currentMessages.slice(0, revertIndex + 1)
          useCopilotStore.setState({ messages: truncatedMessages })

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
              logger.error('Failed to update messages in DB after revert:', error)
            }
          }
        }

        setShowRestoreConfirmation(false)
        onRevertModeChange?.(false)
        onEditModeChange?.(true)

        logger.info('Checkpoint reverted and removed from message', {
          messageId: message.id,
          checkpointId: latestCheckpoint.id,
        })
      } catch (error) {
        logger.error('Failed to revert to checkpoint:', error)
        setShowRestoreConfirmation(false)
        onRevertModeChange?.(false)
      }
    }
  }, [
    messageCheckpoints,
    revertToCheckpoint,
    message.id,
    messages,
    currentChat,
    onRevertModeChange,
    onEditModeChange,
  ])

  /**
   * Cancels checkpoint revert
   */
  const handleCancelRevert = useCallback(() => {
    setShowRestoreConfirmation(false)
    onRevertModeChange?.(false)
  }, [onRevertModeChange])

  /**
   * Handles "Continue and revert" action for checkpoint discard modal
   * Reverts to checkpoint then proceeds with pending edit
   */
  const handleContinueAndRevert = useCallback(async () => {
    if (messageCheckpoints.length > 0) {
      const latestCheckpoint = messageCheckpoints[0]
      try {
        await revertToCheckpoint(latestCheckpoint.id)

        const { messageCheckpoints: currentCheckpoints } = useCopilotStore.getState()
        const updatedCheckpoints = {
          ...currentCheckpoints,
          [message.id]: messageCheckpoints.slice(1),
        }
        useCopilotStore.setState({ messageCheckpoints: updatedCheckpoints })

        logger.info('Reverted to checkpoint before editing message', {
          messageId: message.id,
          checkpointId: latestCheckpoint.id,
        })
      } catch (error) {
        logger.error('Failed to revert to checkpoint:', error)
      }
    }

    setShowCheckpointDiscardModal(false)

    const { sendMessage } = useCopilotStore.getState()
    if (pendingEditRef.current) {
      const { message: msg, fileAttachments, contexts } = pendingEditRef.current
      const editIndex = messages.findIndex((m) => m.id === message.id)
      if (editIndex !== -1) {
        const truncatedMessages = messages.slice(0, editIndex)
        const updatedMessage = {
          ...message,
          content: msg,
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
        }
        useCopilotStore.setState({ messages: [...truncatedMessages, updatedMessage] })

        await sendMessage(msg, {
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
          messageId: message.id,
        })
      }
      pendingEditRef.current = null
    }
  }, [messageCheckpoints, revertToCheckpoint, message, messages])

  /**
   * Cancels checkpoint discard and clears pending edit
   */
  const handleCancelCheckpointDiscard = useCallback(() => {
    setShowCheckpointDiscardModal(false)
    pendingEditRef.current = null
  }, [])

  /**
   * Continues with edit WITHOUT reverting checkpoint
   */
  const handleContinueWithoutRevert = useCallback(async () => {
    setShowCheckpointDiscardModal(false)

    if (pendingEditRef.current) {
      const { message: msg, fileAttachments, contexts } = pendingEditRef.current
      const { sendMessage } = useCopilotStore.getState()
      const editIndex = messages.findIndex((m) => m.id === message.id)
      if (editIndex !== -1) {
        const truncatedMessages = messages.slice(0, editIndex)
        const updatedMessage = {
          ...message,
          content: msg,
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
        }
        useCopilotStore.setState({ messages: [...truncatedMessages, updatedMessage] })

        await sendMessage(msg, {
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
          messageId: message.id,
        })
      }
      pendingEditRef.current = null
    }
  }, [message, messages])

  /**
   * Handles keyboard events for restore confirmation (Escape/Enter)
   */
  useEffect(() => {
    if (!showRestoreConfirmation) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancelRevert()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handleConfirmRevert()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showRestoreConfirmation, handleCancelRevert, handleConfirmRevert])

  /**
   * Handles keyboard events for checkpoint discard modal (Escape/Enter)
   */
  useEffect(() => {
    if (!showCheckpointDiscardModal) return

    const handleCheckpointDiscardKeyDown = async (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancelCheckpointDiscard()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        await handleContinueAndRevert()
      }
    }

    document.addEventListener('keydown', handleCheckpointDiscardKeyDown)
    return () => document.removeEventListener('keydown', handleCheckpointDiscardKeyDown)
  }, [showCheckpointDiscardModal, handleCancelCheckpointDiscard, handleContinueAndRevert])

  return {
    // State
    showRestoreConfirmation,
    showCheckpointDiscardModal,
    pendingEditRef,

    // Operations
    setShowCheckpointDiscardModal,
    handleRevertToCheckpoint,
    handleConfirmRevert,
    handleCancelRevert,
    handleCancelCheckpointDiscard,
    handleContinueWithoutRevert,
    handleContinueAndRevert,
  }
}
