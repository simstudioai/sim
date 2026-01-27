'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import type { CopilotMessage } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'

const logger = createLogger('useCheckpointManagement')

/**
 * Custom hook to handle checkpoint-related operations for messages
 *
 * @param message - The copilot message
 * @param messages - Array of all messages in the chat
 * @param messageCheckpoints - Checkpoints for this message
 * @param onRevertModeChange - Callback for revert mode changes
 * @param onEditModeChange - Callback for edit mode changes
 * @param onCancelEdit - Callback when edit is cancelled
 * @returns Checkpoint management utilities
 */
export function useCheckpointManagement(
  message: CopilotMessage,
  messages: CopilotMessage[],
  messageCheckpoints: any[],
  onRevertModeChange?: (isReverting: boolean) => void,
  onEditModeChange?: (isEditing: boolean) => void,
  onCancelEdit?: () => void
) {
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false)
  const [showCheckpointDiscardModal, setShowCheckpointDiscardModal] = useState(false)
  const [isReverting, setIsReverting] = useState(false)
  const [isProcessingDiscard, setIsProcessingDiscard] = useState(false)
  const pendingEditRef = useRef<{
    message: string
    fileAttachments?: any[]
    contexts?: any[]
  } | null>(null)

  const { revertToCheckpoint, currentChat } = useCopilotStore()

  /** Initiates checkpoint revert confirmation */
  const handleRevertToCheckpoint = useCallback(() => {
    setShowRestoreConfirmation(true)
    onRevertModeChange?.(true)
  }, [onRevertModeChange])

  /** Confirms and executes checkpoint revert */
  const handleConfirmRevert = useCallback(async () => {
    if (messageCheckpoints.length > 0) {
      const latestCheckpoint = messageCheckpoints[0]
      setIsReverting(true)
      try {
        await revertToCheckpoint(latestCheckpoint.id)

        const { messageCheckpoints: currentCheckpoints } = useCopilotStore.getState()
        const updatedCheckpoints = {
          ...currentCheckpoints,
          [message.id]: [],
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

        logger.info('Checkpoint reverted and removed from message', {
          messageId: message.id,
          checkpointId: latestCheckpoint.id,
        })
      } catch (error) {
        logger.error('Failed to revert to checkpoint:', error)
        setShowRestoreConfirmation(false)
        onRevertModeChange?.(false)
      } finally {
        setIsReverting(false)
      }
    }
  }, [
    messageCheckpoints,
    revertToCheckpoint,
    message.id,
    messages,
    currentChat,
    onRevertModeChange,
  ])

  /** Cancels checkpoint revert */
  const handleCancelRevert = useCallback(() => {
    setShowRestoreConfirmation(false)
    onRevertModeChange?.(false)
  }, [onRevertModeChange])

  /** Reverts to checkpoint then proceeds with pending edit */
  const handleContinueAndRevert = useCallback(async () => {
    setIsProcessingDiscard(true)
    try {
      if (messageCheckpoints.length > 0) {
        const latestCheckpoint = messageCheckpoints[0]
        try {
          await revertToCheckpoint(latestCheckpoint.id)

          const { messageCheckpoints: currentCheckpoints } = useCopilotStore.getState()
          const updatedCheckpoints = {
            ...currentCheckpoints,
            [message.id]: [],
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
      onEditModeChange?.(false)
      onCancelEdit?.()

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
            queueIfBusy: false,
          })
        }
        pendingEditRef.current = null
      }
    } finally {
      setIsProcessingDiscard(false)
    }
  }, [messageCheckpoints, revertToCheckpoint, message, messages, onEditModeChange, onCancelEdit])

  /** Cancels checkpoint discard and clears pending edit */
  const handleCancelCheckpointDiscard = useCallback(() => {
    setShowCheckpointDiscardModal(false)
    onEditModeChange?.(false)
    onCancelEdit?.()
    pendingEditRef.current = null
  }, [onEditModeChange, onCancelEdit])

  /** Continues with edit without reverting checkpoint */
  const handleContinueWithoutRevert = useCallback(async () => {
    setShowCheckpointDiscardModal(false)
    onEditModeChange?.(false)
    onCancelEdit?.()

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
          queueIfBusy: false,
        })
      }
      pendingEditRef.current = null
    }
  }, [message, messages, onEditModeChange, onCancelEdit])

  /** Handles keyboard events for confirmation dialogs */
  useEffect(() => {
    const isActive = showRestoreConfirmation || showCheckpointDiscardModal
    if (!isActive) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      if (event.key === 'Escape') {
        if (showRestoreConfirmation) handleCancelRevert()
        else handleCancelCheckpointDiscard()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (showRestoreConfirmation) handleConfirmRevert()
        else handleContinueAndRevert()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    showRestoreConfirmation,
    showCheckpointDiscardModal,
    handleCancelRevert,
    handleConfirmRevert,
    handleCancelCheckpointDiscard,
    handleContinueAndRevert,
  ])

  return {
    // State
    showRestoreConfirmation,
    showCheckpointDiscardModal,
    isReverting,
    isProcessingDiscard,
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
