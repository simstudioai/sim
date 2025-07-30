import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { type DiffAnalysis, WorkflowDiffEngine } from './diff-engine'

const logger = createLogger('useWorkflowDiff')

export interface UseWorkflowDiffReturn {
  isShowingDiff: boolean
  hasDiff: boolean
  setProposedChanges: (yamlContent: string, diffAnalysis?: DiffAnalysis) => Promise<boolean>
  clearDiff: () => void
  acceptChanges: () => Promise<boolean>
  rejectChanges: () => void
  toggleDiffView: () => void
  getCurrentWorkflowForCanvas: () => any
}

/**
 * Hook that provides workflow diff functionality
 * without polluting core stores
 */
export function useWorkflowDiff(): UseWorkflowDiffReturn {
  const [isShowingDiff, setIsShowingDiff] = useState(false)
  const diffEngineRef = useRef<WorkflowDiffEngine | null>(null)

  // Get store methods
  const workflowStore = useWorkflowStore()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Initialize diff engine
  if (!diffEngineRef.current) {
    diffEngineRef.current = new WorkflowDiffEngine()
  }

  const setProposedChanges = useCallback(
    async (yamlContent: string, diffAnalysis?: DiffAnalysis): Promise<boolean> => {
      try {
        logger.info('Setting proposed changes')

        const result = await diffEngineRef.current!.createDiffFromYaml(yamlContent, diffAnalysis)

        if (result.success) {
          setIsShowingDiff(true)
          return true
        }

        logger.error('Failed to create diff:', result.errors)
        return false
      } catch (error) {
        logger.error('Error setting proposed changes:', error)
        return false
      }
    },
    []
  )

  const clearDiff = useCallback(() => {
    logger.info('Clearing diff')
    diffEngineRef.current!.clearDiff()
    setIsShowingDiff(false)
  }, [])

  const acceptChanges = useCallback(async (): Promise<boolean> => {
    if (!activeWorkflowId) {
      logger.error('No active workflow ID')
      return false
    }

    try {
      logger.info('Accepting diff changes')

      const cleanState = diffEngineRef.current!.acceptDiff()
      if (!cleanState) {
        logger.warn('No diff to accept')
        return false
      }

      // Update workflow store with the clean state
      useWorkflowStore.setState({
        blocks: cleanState.blocks,
        edges: cleanState.edges,
        loops: cleanState.loops,
        parallels: cleanState.parallels,
      })

      // Update subblock store with values from diff
      const subblockValues: Record<string, Record<string, any>> = {}
      Object.entries(cleanState.blocks).forEach(([blockId, block]) => {
        subblockValues[blockId] = {}
        Object.entries(block.subBlocks || {}).forEach(([subblockId, subblock]) => {
          subblockValues[blockId][subblockId] = subblock.value
        })
      })

      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: subblockValues,
        },
      }))

      // Update last saved timestamp
      workflowStore.updateLastSaved()

      // Persist to database
      try {
        const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...cleanState,
            lastSaved: Date.now(),
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to save: ${response.statusText}`)
        }

        logger.info('Diff changes persisted to database')
      } catch (error) {
        logger.error('Failed to persist diff changes:', error)
        // State is already updated locally, so don't fail the operation
      }

      setIsShowingDiff(false)
      return true
    } catch (error) {
      logger.error('Failed to accept changes:', error)
      return false
    }
  }, [activeWorkflowId, workflowStore])

  const rejectChanges = useCallback(() => {
    logger.info('Rejecting diff changes')
    clearDiff()
  }, [clearDiff])

  const toggleDiffView = useCallback(() => {
    setIsShowingDiff((prev) => !prev)
  }, [])

  const getCurrentWorkflowForCanvas = useCallback(() => {
    const currentState = workflowStore.getWorkflowState()

    if (isShowingDiff && diffEngineRef.current!.hasDiff()) {
      return diffEngineRef.current!.getDisplayState(currentState)
    }

    return currentState
  }, [isShowingDiff, workflowStore])

  return {
    isShowingDiff,
    hasDiff: diffEngineRef.current!.hasDiff(),
    setProposedChanges,
    clearDiff,
    acceptChanges,
    rejectChanges,
    toggleDiffView,
    getCurrentWorkflowForCanvas,
  }
}
