import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import type { LocalWorkflowOperations } from '@/lib/workflows/local-operations'

const logger = createLogger('WorkflowSaveState')

interface SaveState {
  isDirty: boolean
  isSaving: boolean
  lastSaved?: number
  error?: string
}

/**
 * Hook to manage workflow save state for non-collaborative mode
 */
export function useWorkflowSaveState(operationManager: LocalWorkflowOperations | null) {
  const [saveState, setSaveState] = useState<SaveState>({
    isDirty: false,
    isSaving: false,
  })

  // Update dirty state when operation manager changes
  useEffect(() => {
    if (!operationManager) return

    const updateDirtyState = () => {
      setSaveState((prev) => ({
        ...prev,
        isDirty: operationManager.isDirty(),
      }))
    }

    // Initial check
    updateDirtyState()

    // Subscribe to changes
    const unsubscribe = operationManager.onDirtyStateChange(updateDirtyState)

    return unsubscribe
  }, [operationManager])

  const save = useCallback(async () => {
    if (!operationManager) {
      return
    }

    // Check current state to avoid stale closure issues
    setSaveState((prev) => {
      if (!prev.isDirty || prev.isSaving) {
        return prev // Don't start save if not dirty or already saving
      }

      return {
        ...prev,
        isSaving: true,
        error: undefined,
      }
    })

    try {
      await operationManager.save()
      setSaveState((prev) => ({
        ...prev,
        isDirty: false,
        isSaving: false,
        lastSaved: Date.now(),
        error: undefined,
      }))
      logger.info('Workflow saved successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save workflow'
      setSaveState((prev) => ({
        ...prev,
        isSaving: false,
        error: errorMessage,
      }))
      logger.error('Failed to save workflow:', error)
    }
  }, [operationManager])

  const clearError = useCallback(() => {
    setSaveState((prev) => ({
      ...prev,
      error: undefined,
    }))
  }, [])

  return {
    ...saveState,
    save,
    clearError,
  }
}
