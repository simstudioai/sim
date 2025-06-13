'use client'

import { useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { fetchWorkflowsFromDB } from '@/stores/workflows/sync'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('TabSync')

export interface TabSyncOptions {
  /** Whether tab sync is enabled. Default: true */
  enabled?: boolean
  /** Minimum time in ms between syncs. Default: 2000 */
  minSyncInterval?: number
}

/**
 * Helper function to normalize blocks for comparison, excluding position data
 * This focuses on structural changes rather than movement
 */
function normalizeBlocksForComparison(blocks: Record<string, any>) {
  const normalized: Record<string, any> = {}

  for (const [id, block] of Object.entries(blocks)) {
    normalized[id] = {
      ...block,
      // Exclude position from comparison to avoid movement sync issues
      position: undefined,
    }
  }

  return normalized
}

/**
 * Hook that automatically syncs the workflow editor when the user switches back to the tab.
 * This prevents the "newest write wins" issue by ensuring users always see the latest version.
 * Note: This excludes position changes to avoid inconsistent movement syncing.
 */
export function useTabSync(options: TabSyncOptions = {}) {
  const {
    enabled = true,
    minSyncInterval = 2000, // Increased to reduce conflicts
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

    // Prevent concurrent syncs
    isSyncingRef.current = true
    lastSyncRef.current = now

    try {
      logger.info('Tab became visible - checking for workflow updates')

      // Store current complete workflow state for comparison (excluding positions)
      const currentState = {
        blocks: { ...workflowStore.blocks },
        edges: [...workflowStore.edges],
        loops: { ...workflowStore.loops },
        parallels: { ...workflowStore.parallels },
        lastSaved: workflowStore.lastSaved || 0,
        isDeployed: workflowStore.isDeployed,
        deployedAt: workflowStore.deployedAt,
        needsRedeployment: workflowStore.needsRedeployment,
        hasActiveSchedule: workflowStore.hasActiveSchedule,
        hasActiveWebhook: workflowStore.hasActiveWebhook,
      }

      // Wait for any pending writes to complete before fetching
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Force a fresh fetch from database to ensure we get the absolute latest state
      await fetchWorkflowsFromDB()

      // Wait a bit more to ensure the fetch has fully completed and localStorage is updated
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Get the updated workflow from the registry
      const updatedWorkflow = useWorkflowRegistry.getState().workflows[activeWorkflowId]

      if (!updatedWorkflow) {
        logger.warn('Active workflow not found after sync')
        return
      }

      // Load the updated workflow state from localStorage (populated by fetchWorkflowsFromDB)
      const workflowStateKey = `workflow-${activeWorkflowId}`
      const subBlockValuesKey = `subblock-values-${activeWorkflowId}`

      const updatedWorkflowState = localStorage.getItem(workflowStateKey)
      const updatedSubBlockValues = localStorage.getItem(subBlockValuesKey)

      if (!updatedWorkflowState) {
        logger.warn('No updated workflow state found in localStorage')
        return
      }

      const newWorkflowState = JSON.parse(updatedWorkflowState)
      const newSubBlockValues = updatedSubBlockValues ? JSON.parse(updatedSubBlockValues) : {}
      const newLastSaved = newWorkflowState.lastSaved || 0

      // **CRITICAL: Only update if the database version is actually newer**
      // This prevents overriding newer local changes with older database state
      if (newLastSaved <= currentState.lastSaved) {
        logger.debug('Database state is not newer than current state, skipping update', {
          currentLastSaved: new Date(currentState.lastSaved).toISOString(),
          newLastSaved: new Date(newLastSaved).toISOString(),
        })
        return
      }

      // Structural comparison - exclude positions to avoid movement sync issues
      const currentStateStr = JSON.stringify({
        blocks: normalizeBlocksForComparison(currentState.blocks),
        edges: currentState.edges,
        loops: currentState.loops,
        parallels: currentState.parallels,
      })

      const newStateStr = JSON.stringify({
        blocks: normalizeBlocksForComparison(newWorkflowState.blocks || {}),
        edges: newWorkflowState.edges || [],
        loops: newWorkflowState.loops || {},
        parallels: newWorkflowState.parallels || {},
      })

      const hasStructuralChanges = currentStateStr !== newStateStr

      // More detailed change detection for logging (also excluding positions)
      const hasBlockChanges =
        JSON.stringify(normalizeBlocksForComparison(currentState.blocks)) !==
        JSON.stringify(normalizeBlocksForComparison(newWorkflowState.blocks || {}))
      const hasEdgeChanges =
        JSON.stringify(currentState.edges) !== JSON.stringify(newWorkflowState.edges || [])
      const hasLoopChanges =
        JSON.stringify(currentState.loops) !== JSON.stringify(newWorkflowState.loops || {})
      const hasParallelChanges =
        JSON.stringify(currentState.parallels) !== JSON.stringify(newWorkflowState.parallels || {})

      if (hasStructuralChanges) {
        logger.info('Newer structural changes detected - updating editor', {
          activeWorkflowId,
          blocksChanged: hasBlockChanges,
          edgesChanged: hasEdgeChanges,
          loopsChanged: hasLoopChanges,
          parallelsChanged: hasParallelChanges,
          currentBlockCount: Object.keys(currentState.blocks).length,
          newBlockCount: Object.keys(newWorkflowState.blocks || {}).length,
          currentEdgeCount: currentState.edges.length,
          newEdgeCount: (newWorkflowState.edges || []).length,
          timeDiff: newLastSaved - currentState.lastSaved,
          note: 'Positions preserved to avoid movement conflicts',
        })

        // Merge new structural changes while preserving current positions
        const mergedBlocks = { ...(newWorkflowState.blocks || {}) }

        // Preserve current positions to avoid movement conflicts
        for (const [blockId, currentBlock] of Object.entries(currentState.blocks)) {
          if (mergedBlocks[blockId] && currentBlock.position) {
            mergedBlocks[blockId] = {
              ...mergedBlocks[blockId],
              position: currentBlock.position, // Keep current position
            }
          }
        }

        // Update the workflow store with structural changes but preserved positions
        const completeStateUpdate = {
          blocks: mergedBlocks,
          edges: newWorkflowState.edges || [],
          loops: newWorkflowState.loops || {},
          parallels: newWorkflowState.parallels || {},
          lastSaved: newLastSaved,
          isDeployed:
            newWorkflowState.isDeployed !== undefined
              ? newWorkflowState.isDeployed
              : currentState.isDeployed,
          deployedAt:
            newWorkflowState.deployedAt !== undefined
              ? newWorkflowState.deployedAt
              : currentState.deployedAt,
          needsRedeployment:
            newWorkflowState.needsRedeployment !== undefined
              ? newWorkflowState.needsRedeployment
              : currentState.needsRedeployment,
          hasActiveSchedule:
            newWorkflowState.hasActiveSchedule !== undefined
              ? newWorkflowState.hasActiveSchedule
              : currentState.hasActiveSchedule,
          hasActiveWebhook:
            newWorkflowState.hasActiveWebhook !== undefined
              ? newWorkflowState.hasActiveWebhook
              : currentState.hasActiveWebhook,
        }

        useWorkflowStore.setState(completeStateUpdate)

        // Update subblock values
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [activeWorkflowId]: newSubBlockValues,
          },
        }))

        logger.info('Workflow editor successfully synced structural changes (positions preserved)')
      } else {
        logger.debug('No structural changes detected, positions preserved')
      }
    } catch (error) {
      logger.error('Failed to sync workflow editor:', error)
    } finally {
      // Always release the sync lock
      isSyncingRef.current = false
    }
  }, [
    enabled,
    activeWorkflowId,
    minSyncInterval,
    workflowStore.blocks,
    workflowStore.edges,
    workflowStore.loops,
    workflowStore.parallels,
    workflowStore.lastSaved,
    workflowStore.isDeployed,
    workflowStore.deployedAt,
    workflowStore.needsRedeployment,
    workflowStore.hasActiveSchedule,
    workflowStore.hasActiveWebhook,
  ])

  // Handle tab visibility changes
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleVisibilityChange = () => {
      // Only sync when tab becomes visible (not when it becomes hidden)
      if (document.visibilityState === 'visible') {
        logger.debug('Tab became visible - triggering structural sync check')
        // Use a longer delay to allow any ongoing operations to complete
        const timeoutId = setTimeout(() => {
          syncWorkflowEditor()
        }, 300)
        timeoutRefs.current.push(timeoutId)
      }
    }

    // Also handle window focus as a fallback for older browsers
    const handleWindowFocus = () => {
      logger.debug('Window focused - triggering structural sync check')
      // Use a longer delay to allow any ongoing operations to complete
      const timeoutId = setTimeout(() => {
        syncWorkflowEditor()
      }, 300)
      timeoutRefs.current.push(timeoutId)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      // Clear any pending timeouts to prevent memory leaks
      timeoutRefs.current.forEach(clearTimeout)
      timeoutRefs.current = []

      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [enabled, syncWorkflowEditor])

  // Return the sync function for manual triggering if needed
  return {
    syncWorkflowEditor,
  }
}
