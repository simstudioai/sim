'use client'

import { useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { changeTracker } from '@/stores/workflows/granular-sync'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  getWorkflowChanges,
  hasUnsavedChanges,
  isActivelyLoadingFromDB,
  isRegistryInitialized,
  syncWorkflow,
} from '@/stores/workflows/sync'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('GranularTabSync')

export interface TabSyncOptions {
  /** Whether tab sync is enabled. Default: true */
  enabled?: boolean
  /** Minimum time in ms between syncs. Default: 1000 */
  minSyncInterval?: number
  /** Enable real-time collaboration features. Default: true */
  enableRealTimeSync?: boolean
  /** Enable conflict resolution. Default: true */
  enableConflictResolution?: boolean
}

/**
 * Hook for granular tab sync with real-time collaboration support
 * Provides component-level syncing instead of full workflow syncing
 */
export function useTabSync(options: TabSyncOptions = {}) {
  const {
    enabled = true,
    minSyncInterval = 1000,
    enableRealTimeSync = true,
    enableConflictResolution = true,
  } = options

  const lastSyncRef = useRef<number>(0)
  const isSyncingRef = useRef<boolean>(false)
  const timeoutRefs = useRef<NodeJS.Timeout[]>([])
  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowStore = useWorkflowStore()

  const syncWorkflowEditor = useCallback(async () => {
    if (!enabled || !activeWorkflowId || isSyncingRef.current) {
      return
    }

    // Rate limiting - prevent too frequent syncs
    const now = Date.now()
    if (now - lastSyncRef.current < minSyncInterval) {
      logger.debug('Sync skipped due to rate limiting')
      return
    }

    // Skip if registry not ready
    if (!isRegistryInitialized() || isActivelyLoadingFromDB()) {
      logger.debug('Sync skipped - registry not ready')
      return
    }

    // Prevent concurrent syncs
    isSyncingRef.current = true
    lastSyncRef.current = now

    try {
      logger.info(`Tab sync triggered for workflow ${activeWorkflowId}`)

      // Get current local state
      const currentLocalState = {
        blocks: { ...workflowStore.blocks },
        edges: [...workflowStore.edges],
        loops: { ...workflowStore.loops },
        parallels: { ...workflowStore.parallels },
        lastSaved: workflowStore.lastSaved || 0,
        metadata: {
          isDeployed: workflowStore.isDeployed,
          deployedAt: workflowStore.deployedAt,
          needsRedeployment: workflowStore.needsRedeployment,
          hasActiveSchedule: workflowStore.hasActiveSchedule,
          hasActiveWebhook: workflowStore.hasActiveWebhook,
        },
      }

      // Check if we have unsaved local changes
      const hasLocalChanges = hasUnsavedChanges(activeWorkflowId)

      if (hasLocalChanges) {
        const pendingChanges = getWorkflowChanges(activeWorkflowId)
        logger.info(`Found ${pendingChanges.length} unsaved local changes`, {
          changesSummary: changeTracker.getChangesSummary(activeWorkflowId),
        })
      }

      // Fetch latest changes from server using granular sync
      const syncSuccess = await syncWorkflow(activeWorkflowId)

      if (!syncSuccess) {
        logger.warn('Failed to sync workflow from server')
        return
      }

      // After sync, check if there are server changes to apply locally
      await checkAndApplyServerChanges(activeWorkflowId, currentLocalState)

      logger.info('Granular tab sync completed successfully')
    } catch (error) {
      logger.error('Failed to perform granular tab sync:', error)
    } finally {
      // Always release the sync lock
      isSyncingRef.current = false
    }
  }, [
    enabled,
    activeWorkflowId,
    minSyncInterval,
    enableRealTimeSync,
    enableConflictResolution,
    workflowStore.blocks,
    workflowStore.edges,
    workflowStore.loops,
    workflowStore.parallels,
    workflowStore.lastSaved,
  ])

  /**
   * Check for server changes and apply them to local state
   */
  const checkAndApplyServerChanges = useCallback(
    async (workflowId: string, currentLocalState: any) => {
      try {
        // Get the updated workflow state from localStorage (updated by sync)
        const workflowStateKey = `workflow-${workflowId}`
        const subBlockValuesKey = `subblock-values-${workflowId}`

        const updatedWorkflowState = localStorage.getItem(workflowStateKey)
        const updatedSubBlockValues = localStorage.getItem(subBlockValuesKey)

        if (!updatedWorkflowState) {
          logger.debug('No updated workflow state found')
          return
        }

        const newWorkflowState = JSON.parse(updatedWorkflowState)
        const newSubBlockValues = updatedSubBlockValues ? JSON.parse(updatedSubBlockValues) : {}
        const newLastSaved = newWorkflowState.lastSaved || 0

        // **CRITICAL: Only update if the server version is actually newer**
        if (newLastSaved <= currentLocalState.lastSaved) {
          logger.debug('Server state is not newer than local state, skipping update', {
            localLastSaved: new Date(currentLocalState.lastSaved).toISOString(),
            serverLastSaved: new Date(newLastSaved).toISOString(),
          })
          return
        }

        // Simple JSON comparison to detect changes
        const hasChanges = hasWorkflowChanges(currentLocalState, newWorkflowState)

        if (!hasChanges) {
          logger.debug('No workflow changes detected')
          return
        }

        logger.info('Server changes detected - applying updates', {
          workflowId,
          serverTimestamp: new Date(newLastSaved).toISOString(),
        })

        // Apply changes with conflict resolution
        const mergedState = enableConflictResolution
          ? applyChangesWithConflictResolution(currentLocalState, newWorkflowState)
          : newWorkflowState

        // Update the workflow store with the merged changes
        useWorkflowStore.setState({
          blocks: mergedState.blocks || {},
          edges: mergedState.edges || [],
          loops: mergedState.loops || {},
          parallels: mergedState.parallels || {},
          lastSaved: newLastSaved,
          // Preserve local metadata unless specifically changed
          isDeployed: mergedState.isDeployed ?? currentLocalState.metadata.isDeployed,
          deployedAt: mergedState.deployedAt ?? currentLocalState.metadata.deployedAt,
          needsRedeployment:
            mergedState.needsRedeployment ?? currentLocalState.metadata.needsRedeployment,
          hasActiveSchedule:
            mergedState.hasActiveSchedule ?? currentLocalState.metadata.hasActiveSchedule,
          hasActiveWebhook:
            mergedState.hasActiveWebhook ?? currentLocalState.metadata.hasActiveWebhook,
        })

        // Update subblock values
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [workflowId]: newSubBlockValues,
          },
        }))

        logger.info('Successfully applied server changes with granular sync')
      } catch (error) {
        logger.error('Error applying server changes:', error)
      }
    },
    [enableConflictResolution]
  )

  /**
   * Simple comparison to check if workflows are different
   */
  const hasWorkflowChanges = useCallback((local: any, server: any): boolean => {
    // Quick comparison excluding metadata and timestamps
    const localCore = {
      blocks: local.blocks,
      edges: local.edges,
      loops: local.loops,
      parallels: local.parallels,
    }

    const serverCore = {
      blocks: server.blocks,
      edges: server.edges,
      loops: server.loops,
      parallels: server.parallels,
    }

    return JSON.stringify(localCore) !== JSON.stringify(serverCore)
  }, [])

  /**
   * Apply changes with smart conflict resolution
   */
  const applyChangesWithConflictResolution = useCallback(
    (localState: any, serverState: any): any => {
      // Simple merge strategy that preserves local positions
      const mergedState = { ...serverState }

      // Preserve local positions to avoid jarring movement
      Object.keys(localState.blocks || {}).forEach((blockId) => {
        if (mergedState.blocks?.[blockId] && localState.blocks[blockId]?.position) {
          mergedState.blocks[blockId] = {
            ...mergedState.blocks[blockId],
            position: localState.blocks[blockId].position,
          }
        }
      })

      logger.debug('Applied conflict resolution - preserved local positions')
      return mergedState
    },
    []
  )

  // Handle tab visibility changes
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleVisibilityChange = () => {
      // Only sync when tab becomes visible
      if (document.visibilityState === 'visible') {
        logger.debug('Tab became visible - triggering granular sync')
        const timeoutId = setTimeout(() => {
          syncWorkflowEditor()
        }, 150)
        timeoutRefs.current.push(timeoutId)
      }
    }

    // Handle window focus as a fallback
    const handleWindowFocus = () => {
      logger.debug('Window focused - triggering granular sync')
      const timeoutId = setTimeout(() => {
        syncWorkflowEditor()
      }, 150)
      timeoutRefs.current.push(timeoutId)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      // Clear any pending timeouts
      timeoutRefs.current.forEach(clearTimeout)
      timeoutRefs.current = []

      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [enabled, syncWorkflowEditor])

  // Real-time sync interval for active collaboration
  useEffect(() => {
    if (!enabled || !enableRealTimeSync || !activeWorkflowId) {
      return
    }

    // More frequent syncing for real-time collaboration
    const intervalId = setInterval(() => {
      if (hasUnsavedChanges(activeWorkflowId)) {
        logger.debug('Real-time sync: unsaved changes detected')
        syncWorkflowEditor()
      }
    }, 5000) // Sync every 5 seconds if there are changes

    return () => {
      clearInterval(intervalId)
    }
  }, [enabled, enableRealTimeSync, activeWorkflowId, syncWorkflowEditor])

  // Return enhanced sync interface
  return {
    syncWorkflowEditor,
    hasUnsavedChanges: activeWorkflowId ? hasUnsavedChanges(activeWorkflowId) : false,
    pendingChangesCount: activeWorkflowId ? getWorkflowChanges(activeWorkflowId).length : 0,
    isRealTimeSyncEnabled: enableRealTimeSync,
    lastSyncTime: lastSyncRef.current,
  }
}
