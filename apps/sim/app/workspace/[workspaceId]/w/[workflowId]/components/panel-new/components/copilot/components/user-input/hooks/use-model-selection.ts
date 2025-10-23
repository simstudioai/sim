import { useCallback, useRef } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'

const logger = createLogger('useModelSelection')

/**
 * Custom hook to manage model selection and enabled models.
 * Handles fetching user's enabled models from API and provides model selection operations.
 *
 * @returns Model selection state and operations
 */
export function useModelSelection() {
  const {
    selectedModel,
    agentPrefetch,
    enabledModels,
    setSelectedModel,
    setAgentPrefetch,
    setEnabledModels,
  } = useCopilotStore()

  const isFetchingRef = useRef(false)

  /**
   * Fetches enabled models from API on first dropdown open
   */
  const fetchEnabledModelsOnce = useCallback(async () => {
    if (enabledModels !== null || isFetchingRef.current) return

    try {
      isFetchingRef.current = true
      const res = await fetch('/api/copilot/user-models')
      if (!res.ok) {
        logger.error('Failed to fetch enabled models')
        return
      }
      const data = await res.json()
      const modelsMap = data.enabledModels || {}

      // Convert to array for store (API already merged with defaults)
      const enabledArray = Object.entries(modelsMap)
        .filter(([_, enabled]) => enabled)
        .map(([modelId]) => modelId)
      setEnabledModels(enabledArray)
    } catch (error) {
      logger.error('Error fetching enabled models', { error })
    } finally {
      isFetchingRef.current = false
    }
  }, [enabledModels, setEnabledModels])

  return {
    // State
    selectedModel,
    agentPrefetch,
    enabledModels,

    // Operations
    setSelectedModel,
    setAgentPrefetch,
    fetchEnabledModelsOnce,
  }
}
