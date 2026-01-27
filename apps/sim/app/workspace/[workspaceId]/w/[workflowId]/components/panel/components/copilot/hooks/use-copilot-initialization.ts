'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('useCopilotInitialization')

interface UseCopilotInitializationProps {
  activeWorkflowId: string | null
  isLoadingChats: boolean
  chatsLoadedForWorkflow: string | null
  setCopilotWorkflowId: (workflowId: string | null) => Promise<void>
  loadChats: (forceRefresh?: boolean) => Promise<void>
  loadAutoAllowedTools: () => Promise<void>
  currentChat: any
  isSendingMessage: boolean
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
    loadAutoAllowedTools,
    currentChat,
    isSendingMessage,
  } = props

  const [isInitialized, setIsInitialized] = useState(false)
  const lastWorkflowIdRef = useRef<string | null>(null)
  const hasMountedRef = useRef(false)

  /** Initialize on mount - loads chats if needed. Never loads during streaming */
  useEffect(() => {
    if (activeWorkflowId && !hasMountedRef.current && !isSendingMessage) {
      hasMountedRef.current = true
      setIsInitialized(false)
      lastWorkflowIdRef.current = null

      setCopilotWorkflowId(activeWorkflowId)
      loadChats(false)
    }
  }, [activeWorkflowId, setCopilotWorkflowId, loadChats, isSendingMessage])

  /** Handles genuine workflow changes, preventing re-init on every render */
  useEffect(() => {
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

    if (
      activeWorkflowId &&
      !isLoadingChats &&
      chatsLoadedForWorkflow !== null &&
      chatsLoadedForWorkflow !== activeWorkflowId &&
      !isSendingMessage
    ) {
      logger.info('Chats loaded for wrong workflow, reloading', {
        loaded: chatsLoadedForWorkflow,
        active: activeWorkflowId,
      })
      setIsInitialized(false)
      lastWorkflowIdRef.current = activeWorkflowId
      setCopilotWorkflowId(activeWorkflowId)
      loadChats(false)
    }

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

  /** Load auto-allowed tools once on mount - runs immediately, independent of workflow */
  const hasLoadedAutoAllowedToolsRef = useRef(false)
  useEffect(() => {
    if (!hasLoadedAutoAllowedToolsRef.current) {
      hasLoadedAutoAllowedToolsRef.current = true
      loadAutoAllowedTools().catch((err) => {
        logger.warn('[Copilot] Failed to load auto-allowed tools', err)
      })
    }
  }, [loadAutoAllowedTools])

  return {
    isInitialized,
  }
}
