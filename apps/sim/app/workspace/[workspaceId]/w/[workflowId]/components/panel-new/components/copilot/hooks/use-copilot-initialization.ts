'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useCopilotInitialization')

/**
 * Default enabled/disabled state for all models (must match API)
 */
const DEFAULT_ENABLED_MODELS: Record<string, boolean> = {
  'gpt-4o': false,
  'gpt-4.1': false,
  'gpt-5-fast': false,
  'gpt-5': true,
  'gpt-5-medium': true,
  'gpt-5-high': false,
  o3: true,
  'claude-4-sonnet': false,
  'claude-4.5-haiku': true,
  'claude-4.5-sonnet': true,
  'claude-4.1-opus': true,
}

interface UseCopilotInitializationProps {
  activeWorkflowId: string | null
  isLoadingChats: boolean
  chatsLoadedForWorkflow: string | null
  setCopilotWorkflowId: (workflowId: string | null) => Promise<void>
  loadChats: (forceRefresh?: boolean) => Promise<void>
  setEnabledModels: (models: string[]) => void
  enabledModels: string[] | null
  selectedModel: string
  setSelectedModel: (model: any) => Promise<void>
  fetchContextUsage: () => Promise<void>
  currentChat: any
  isSendingMessage: boolean
}

/**
 * Custom hook to handle copilot initialization including model loading and workflow setup
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
    setEnabledModels,
    enabledModels,
    selectedModel,
    setSelectedModel,
    fetchContextUsage,
    currentChat,
    isSendingMessage,
  } = props

  const [isInitialized, setIsInitialized] = useState(false)
  const lastWorkflowIdRef = useRef<string | null>(null)
  const hasMountedRef = useRef(false)
  const hasLoadedModelsRef = useRef(false)

  /**
   * Load user's enabled models from the API
   */
  useEffect(() => {
    const loadEnabledModels = async () => {
      if (hasLoadedModelsRef.current) return
      hasLoadedModelsRef.current = true

      try {
        const res = await fetch('/api/copilot/user-models')
        if (!res.ok) {
          logger.warn('Failed to fetch user models, using defaults')
          const enabledArray = Object.keys(DEFAULT_ENABLED_MODELS).filter(
            (key) => DEFAULT_ENABLED_MODELS[key]
          )
          setEnabledModels(enabledArray)
          return
        }

        const data = await res.json()
        const modelsMap = data.enabledModels || DEFAULT_ENABLED_MODELS

        const enabledArray = Object.entries(modelsMap)
          .filter(([_, enabled]) => enabled)
          .map(([modelId]) => modelId)

        setEnabledModels(enabledArray)
        logger.info('Loaded user enabled models', { count: enabledArray.length })
      } catch (error) {
        logger.error('Failed to load enabled models', { error })
        const enabledArray = Object.keys(DEFAULT_ENABLED_MODELS).filter(
          (key) => DEFAULT_ENABLED_MODELS[key]
        )
        setEnabledModels(enabledArray)
      }
    }

    loadEnabledModels()
  }, [setEnabledModels])

  /**
   * Ensure selected model is in the enabled models list
   */
  useEffect(() => {
    if (!enabledModels || enabledModels.length === 0) return

    if (selectedModel && !enabledModels.includes(selectedModel)) {
      const preferredModel = 'claude-4.5-sonnet'
      const fallbackModel = enabledModels[0] as typeof selectedModel

      if (enabledModels.includes(preferredModel)) {
        setSelectedModel(preferredModel)
        logger.info('Selected model not enabled, switching to preferred model', {
          from: selectedModel,
          to: preferredModel,
        })
      } else if (fallbackModel) {
        setSelectedModel(fallbackModel)
        logger.info('Selected model not enabled, switching to first available', {
          from: selectedModel,
          to: fallbackModel,
        })
      }
    }
  }, [enabledModels, selectedModel, setSelectedModel])

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

  return {
    isInitialized,
  }
}
