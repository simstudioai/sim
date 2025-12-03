'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { getPendingCopilotMessage } from '@/app/workspace/[workspaceId]/superagent/superagent'

const logger = createLogger('useCopilotInitialization')

interface UseCopilotInitializationProps {
  activeWorkflowId: string | null
  isLoadingChats: boolean
  chatsLoadedForWorkflow: string | null
  setCopilotWorkflowId: (workflowId: string | null) => Promise<void>
  loadChats: (forceRefresh?: boolean) => Promise<void>
  fetchContextUsage: () => Promise<void>
  currentChat: any
  isSendingMessage: boolean
  sendMessage: (message: string, options?: { stream?: boolean }) => Promise<void>
  setSelectedModel: (model: any) => Promise<void>
}

/**
 * Custom hook to handle copilot initialization and workflow setup
 *
 * @param props - Configuration for copilot initialization
 * @returns Initialization state
 */
export function useCopilotInitialization(props: UseCopilotInitializationProps) {
  const {
    activeWorkflowId,
    isLoadingChats,
    chatsLoadedForWorkflow,
    setCopilotWorkflowId,
    loadChats,
    fetchContextUsage,
    currentChat,
    isSendingMessage,
    sendMessage,
    setSelectedModel,
  } = props

  const [isInitialized, setIsInitialized] = useState(false)
  const lastWorkflowIdRef = useRef<string | null>(null)
  const hasMountedRef = useRef(false)
  const pendingMessageProcessedRef = useRef(false)

  /**
   * Initialize on mount - only load chats if needed, don't force refresh
   * This prevents unnecessary reloads when the component remounts (e.g., hot reload)
   * Never loads during message streaming to prevent interrupting active conversations
   */
  useEffect(() => {
    if (activeWorkflowId && !hasMountedRef.current && !isSendingMessage) {
      hasMountedRef.current = true
      setIsInitialized(false)
      lastWorkflowIdRef.current = null

      setCopilotWorkflowId(activeWorkflowId)
      // Use false to let the store decide if a reload is needed based on cache
      loadChats(false)
    }
  }, [activeWorkflowId, setCopilotWorkflowId, loadChats, isSendingMessage])

  /**
   * Initialize the component - only on mount and genuine workflow changes
   * Prevents re-initialization on every render or tab switch
   * Never reloads during message streaming to preserve active conversations
   */
  useEffect(() => {
    // Handle genuine workflow changes (not initial mount, not same workflow)
    // Only reload if not currently streaming to avoid interrupting conversations
    if (
      activeWorkflowId &&
      activeWorkflowId !== lastWorkflowIdRef.current &&
      hasMountedRef.current &&
      lastWorkflowIdRef.current !== null && // Only if we've tracked a workflow before
      !isSendingMessage // Don't reload during active streaming
    ) {
      logger.info('Workflow changed, resetting initialization', {
        from: lastWorkflowIdRef.current,
        to: activeWorkflowId,
      })
      setIsInitialized(false)
      lastWorkflowIdRef.current = activeWorkflowId
      setCopilotWorkflowId(activeWorkflowId)
      loadChats(false)
    }

    // Mark as initialized when chats are loaded for the active workflow
    if (
      activeWorkflowId &&
      !isLoadingChats &&
      chatsLoadedForWorkflow === activeWorkflowId &&
      !isInitialized
    ) {
      setIsInitialized(true)
      lastWorkflowIdRef.current = activeWorkflowId
    }
  }, [
    activeWorkflowId,
    isLoadingChats,
    chatsLoadedForWorkflow,
    isInitialized,
    setCopilotWorkflowId,
    loadChats,
    isSendingMessage,
  ])

  /**
   * Fetch context usage when component is initialized and has a current chat
   */
  useEffect(() => {
    if (isInitialized && currentChat?.id && activeWorkflowId) {
      logger.info('[Copilot] Component initialized, fetching context usage')
      fetchContextUsage().catch((err) => {
        logger.warn('[Copilot] Failed to fetch context usage on mount', err)
      })
    }
  }, [isInitialized, currentChat?.id, activeWorkflowId, fetchContextUsage])

  /**
   * Process pending copilot messages from superagent "Save as Workflow" feature
   * This runs once after initialization to send any pending message
   */
  useEffect(() => {
    if (
      isInitialized &&
      activeWorkflowId &&
      !isSendingMessage &&
      !pendingMessageProcessedRef.current
    ) {
      const pendingData = getPendingCopilotMessage()
      if (pendingData && pendingData.workflowId === activeWorkflowId) {
        pendingMessageProcessedRef.current = true
        logger.info('[Copilot] Processing pending message from superagent', {
          workflowId: activeWorkflowId,
          model: pendingData.model,
        })

        // Set the model and send the message
        const processPendingMessage = async () => {
          try {
            await setSelectedModel(pendingData.model as any)
            // Small delay to ensure model is set
            await new Promise((resolve) => setTimeout(resolve, 100))
            await sendMessage(pendingData.message, { stream: true })
          } catch (error) {
            logger.error('[Copilot] Failed to process pending message', error)
          }
        }

        processPendingMessage()
      }
    }
  }, [isInitialized, activeWorkflowId, isSendingMessage, sendMessage, setSelectedModel])

  return {
    isInitialized,
  }
}
