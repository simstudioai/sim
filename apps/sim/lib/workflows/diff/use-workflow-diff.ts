import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { WorkflowDiffEngine } from './diff-engine'

const logger = createLogger('WorkflowDiff')

interface WorkflowBackup {
  workflowState: WorkflowState
  subblockValues: Record<string, Record<string, any>>
  timestamp: number
}

export interface UseWorkflowDiffReturn {
  isShowingDiff: boolean
  isDiffReady: boolean
  diffWorkflow: WorkflowState | null
  diffMetadata: any | null
  toggleDiffView: () => void
  clearDiff: () => void
  acceptChanges: () => Promise<boolean>
  rejectChanges: () => Promise<void>
  createDiff: (proposedState: WorkflowState, metadata?: any) => void
}

export function useWorkflowDiff(): UseWorkflowDiffReturn {
  const [isShowingDiff, setIsShowingDiff] = useState(false)
  const diffEngineRef = useRef<WorkflowDiffEngine>(new WorkflowDiffEngine())
  const lastBackupRef = useRef<WorkflowBackup | null>(null)

  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowStore = useWorkflowStore()
  const { isDiffReady, diffWorkflow, diffMetadata } = useWorkflowDiffStore()

  const toggleDiffView = useCallback(() => {
    setIsShowingDiff((prev) => !prev)
  }, [])

  const clearDiff = useCallback(() => {
    diffEngineRef.current.clearDiff()
    useWorkflowDiffStore.getState().clearDiff()

    setIsShowingDiff(false)
  }, [])

  // Create a backup of current state before applying changes
  const createBackup = useCallback((): WorkflowBackup | null => {
    if (!activeWorkflowId) {
      logger.error('No active workflow ID for backup')
      return null
    }

    const currentState = workflowStore.getWorkflowState()
    const subblockStore = useSubBlockStore.getState()
    const currentSubblockValues = subblockStore.workflowValues[activeWorkflowId] || {}

    const backup: WorkflowBackup = {
      workflowState: {
        blocks: { ...currentState.blocks },
        edges: [...currentState.edges],
        loops: { ...currentState.loops },
        parallels: { ...currentState.parallels },
        lastSaved: currentState.lastSaved,
        isDeployed: currentState.isDeployed,
        deployedAt: currentState.deployedAt,
        deploymentStatuses: { ...currentState.deploymentStatuses },
      },
      subblockValues: JSON.parse(JSON.stringify(currentSubblockValues)), // Deep copy
      timestamp: Date.now(),
    }

    lastBackupRef.current = backup
    logger.info('Created workflow backup before diff acceptance', {
      workflowId: activeWorkflowId,
      blocksCount: Object.keys(backup.workflowState.blocks).length,
      edgesCount: backup.workflowState.edges.length,
    })

    return backup
  }, [activeWorkflowId, workflowStore])

  // Restore state from backup
  const restoreFromBackup = useCallback(
    (backup: WorkflowBackup) => {
      if (!activeWorkflowId) {
        logger.error('No active workflow ID for restore')
        return
      }

      logger.warn('Restoring workflow state from backup due to save failure', {
        workflowId: activeWorkflowId,
        backupTimestamp: backup.timestamp,
      })

      // Restore workflow store state
      useWorkflowStore.setState({
        blocks: backup.workflowState.blocks,
        edges: backup.workflowState.edges,
        loops: backup.workflowState.loops,
        parallels: backup.workflowState.parallels,
        lastSaved: backup.workflowState.lastSaved,
        isDeployed: backup.workflowState.isDeployed,
        deployedAt: backup.workflowState.deployedAt,
        deploymentStatuses: backup.workflowState.deploymentStatuses,
      })

      // Restore subblock values
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: backup.subblockValues,
        },
      }))

      logger.info('Successfully restored workflow state from backup')
    },
    [activeWorkflowId]
  )

  // Create checkpoint before applying changes
  const createCheckpoint = useCallback(async (): Promise<{
    success: boolean
    checkpointId?: string
  }> => {
    if (!activeWorkflowId) {
      logger.error('No active workflow ID for checkpoint')
      return { success: false }
    }

    try {
      const currentState = workflowStore.getWorkflowState()

      // Get current copilot chat ID (if available)
      const { useCopilotStore } = await import('@/stores/copilot/store')
      const { currentChat, messages } = useCopilotStore.getState()

      if (!currentChat?.id) {
        logger.warn('No active copilot chat for checkpoint creation')
        return { success: false }
      }

      // Get the last user message that might have triggered this diff
      const lastUserMessage = messages
        .slice()
        .reverse()
        .find((msg) => msg.role === 'user')

      const response = await fetch('/api/copilot/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: activeWorkflowId,
          chatId: currentChat.id,
          messageId: lastUserMessage?.id,
          workflowState: JSON.stringify(currentState),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Failed to create checkpoint:', errorData)
        return { success: false }
      }

      const result = await response.json()
      logger.info('Created checkpoint before diff acceptance', {
        checkpointId: result.id,
        workflowId: activeWorkflowId,
      })

      return { success: true, checkpointId: result.id }
    } catch (error) {
      logger.error('Failed to create checkpoint:', error)
      return { success: false }
    }
  }, [activeWorkflowId, workflowStore])

  const acceptChanges = useCallback(async (): Promise<boolean> => {
    if (!activeWorkflowId) {
      logger.error('No active workflow ID')
      return false
    }

    // Create backup before making any changes
    const backup = createBackup()
    if (!backup) {
      logger.error('Failed to create backup before accepting changes')
      return false
    }

    // Create checkpoint for potential rollback
    const checkpointResult = await createCheckpoint()
    if (!checkpointResult.success) {
      logger.warn('Failed to create checkpoint, proceeding without it')
    }

    try {
      logger.info('Accepting diff changes with backup protection')

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

      // Persist to database with error handling and rollback
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
          const errorData = await response.json()
          throw new Error(errorData.error || `Failed to save: ${response.statusText}`)
        }

        logger.info('Diff changes persisted to database successfully')

        // Clear the backup since save was successful
        lastBackupRef.current = null
      } catch (error) {
        logger.error('Failed to persist diff changes, rolling back:', error)

        // Rollback to backup state
        restoreFromBackup(backup)

        // Clear the diff since we're reverting
        clearDiff()

        // Show user-friendly error
        throw new Error(
          `Failed to save workflow changes: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
            'The workflow has been restored to its previous state.'
        )
      }

      setIsShowingDiff(false)
      return true
    } catch (error) {
      logger.error('Failed to accept changes:', error)

      // If we haven't already restored from backup, do it now
      if (lastBackupRef.current && lastBackupRef.current.timestamp === backup.timestamp) {
        restoreFromBackup(backup)
      }

      throw error
    }
  }, [
    activeWorkflowId,
    workflowStore,
    createBackup,
    createCheckpoint,
    restoreFromBackup,
    clearDiff,
  ])

  const rejectChanges = useCallback(async () => {
    logger.info('Rejecting diff changes')
    clearDiff()
  }, [clearDiff])

  const getCurrentWorkflowForCanvas = useCallback(() => {
    const currentState = workflowStore.getWorkflowState()

    if (isShowingDiff && diffEngineRef.current!.hasDiff()) {
      return diffEngineRef.current!.getDisplayState(currentState)
    }

    return currentState
  }, [isShowingDiff, workflowStore])

  return {
    isShowingDiff,
    isDiffReady,
    diffWorkflow,
    diffMetadata,
    toggleDiffView,
    clearDiff,
    acceptChanges,
    rejectChanges,
    createDiff: (proposedState: WorkflowState, metadata?: any) => {
      logger.info('Creating diff with proposed state')
      // Note: Implementation may need adjustment based on DiffEngine methods
    },
  }
}
