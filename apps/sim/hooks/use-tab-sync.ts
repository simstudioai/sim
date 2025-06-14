'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { convertGranularToLegacy } from '@/stores/workflows/granular-sync'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { isActivelyLoadingFromDB, isRegistryInitialized } from '@/stores/workflows/sync'
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
 * Smart tab sync that fetches the latest workflow from DB when tab becomes visible
 * Uses granular sync API with sophisticated change detection and position preservation
 */
export function useTabSync(options: TabSyncOptions = {}) {
  const { enabled = true, minSyncInterval = 2000 } = options

  const lastSyncRef = useRef<number>(0)
  const isSyncingRef = useRef<boolean>(false)
  const timeoutRefs = useRef<NodeJS.Timeout[]>([])
  const { activeWorkflowId } = useWorkflowRegistry()
  const { data: session } = useSession()
  const workflowStore = useWorkflowStore()

  const fetchWorkflowFromDB = useCallback(async () => {
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
      logger.info('Tab became visible - checking for workflow updates')

      // Check session for authentication (client-side)
      if (!session?.user?.id) {
        logger.warn('No session found for tab sync')
        return
      }

      // Store current complete workflow state for comparison
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

      // Get current workspace from registry
      const { workflows: registeredWorkflows, activeWorkflowId: currentWorkflowId } =
        useWorkflowRegistry.getState()
      const currentWorkflow = registeredWorkflows[currentWorkflowId || '']
      const workspaceId = currentWorkflow?.workspaceId

      // Wait for any pending writes to complete before fetching
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Fetch latest workflow data from granular sync API
      const url = new URL('/api/workflows/granular-sync', window.location.origin)
      if (workspaceId) {
        url.searchParams.set('workspaceId', workspaceId)
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow: ${response.statusText}`)
      }

      const { data: fetchedWorkflows } = await response.json()

      // Find our specific workflow
      const updatedWorkflow = fetchedWorkflows.find((w: any) => w.id === activeWorkflowId)

      if (!updatedWorkflow) {
        logger.warn(`Workflow ${activeWorkflowId} not found in response`)
        return
      }

      // Convert granular format to workflow store format using the proper conversion function
      const legacyState = convertGranularToLegacy(
        updatedWorkflow.nodes || [],
        updatedWorkflow.edges || [],
        updatedWorkflow.loops || [],
        updatedWorkflow.parallels || []
      )

      const newWorkflowState = {
        blocks: legacyState.blocks || {},
        edges: legacyState.edges || [],
        loops: legacyState.loops || {},
        parallels: legacyState.parallels || {},
        lastSaved: updatedWorkflow.lastSynced
          ? new Date(updatedWorkflow.lastSynced).getTime()
          : Date.now(),
        isDeployed: updatedWorkflow.isDeployed,
        deployedAt: updatedWorkflow.deployedAt,
      }

      // **CRITICAL: Only update if the database version is actually newer**
      // This prevents overriding newer local changes with older database state
      if (newWorkflowState.lastSaved <= currentState.lastSaved) {
        logger.debug('Database state is not newer than current state, skipping update', {
          currentLastSaved: new Date(currentState.lastSaved).toISOString(),
          newLastSaved: new Date(newWorkflowState.lastSaved).toISOString(),
        })
        return
      }

      // Normalize and stringify once to avoid redundant processing
      const currentNormalized = {
        blocks: normalizeBlocksForComparison(currentState.blocks),
        edges: currentState.edges,
        loops: currentState.loops,
        parallels: currentState.parallels,
      }

      const newNormalized = {
        blocks: normalizeBlocksForComparison(newWorkflowState.blocks || {}),
        edges: newWorkflowState.edges || [],
        loops: newWorkflowState.loops || {},
        parallels: newWorkflowState.parallels || {},
      }

      // Cache stringified versions for comparison
      const currentStringified = {
        full: JSON.stringify(currentNormalized),
        blocks: JSON.stringify(currentNormalized.blocks),
        edges: JSON.stringify(currentNormalized.edges),
        loops: JSON.stringify(currentNormalized.loops),
        parallels: JSON.stringify(currentNormalized.parallels),
      }

      const newStringified = {
        full: JSON.stringify(newNormalized),
        blocks: JSON.stringify(newNormalized.blocks),
        edges: JSON.stringify(newNormalized.edges),
        loops: JSON.stringify(newNormalized.loops),
        parallels: JSON.stringify(newNormalized.parallels),
      }

      const hasStructuralChanges = currentStringified.full !== newStringified.full

      // Detailed change detection using cached strings
      const hasBlockChanges = currentStringified.blocks !== newStringified.blocks
      const hasEdgeChanges = currentStringified.edges !== newStringified.edges
      const hasLoopChanges = currentStringified.loops !== newStringified.loops
      const hasParallelChanges = currentStringified.parallels !== newStringified.parallels

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
          timeDiff: newWorkflowState.lastSaved - currentState.lastSaved,
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
          lastSaved: newWorkflowState.lastSaved,
          isDeployed:
            newWorkflowState.isDeployed !== undefined
              ? newWorkflowState.isDeployed
              : currentState.isDeployed,
          deployedAt:
            newWorkflowState.deployedAt !== undefined
              ? newWorkflowState.deployedAt
              : currentState.deployedAt,
          needsRedeployment: false, // Reset since we just synced
          hasActiveSchedule: currentState.hasActiveSchedule, // Keep current state
          hasActiveWebhook: currentState.hasActiveWebhook, // Keep current state
        }

        useWorkflowStore.setState(completeStateUpdate)

        // Update subblock values from the converted blocks (match main sync structure)
        const subBlockValues: Record<string, Record<string, any>> = {}
        Object.entries(mergedBlocks).forEach(([blockId, block]: [string, any]) => {
          if (block.subBlocks && Object.keys(block.subBlocks).length > 0) {
            subBlockValues[blockId] = {}
            // Extract the actual values from each subblock
            Object.entries(block.subBlocks).forEach(([subblockId, subblock]: [string, any]) => {
              if (subblock && typeof subblock === 'object' && 'value' in subblock) {
                subBlockValues[blockId][subblockId] = subblock.value
              }
            })
          }
        })

        if (Object.keys(subBlockValues).length > 0) {
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: subBlockValues,
            },
          }))
          logger.info('Updated subblock values from cross-tab sync', {
            subblockCount: Object.keys(subBlockValues).length,
            subblockIds: Object.keys(subBlockValues),
          })
        }

        logger.info('Workflow editor successfully synced structural changes (positions preserved)')
      } else {
        logger.debug('No structural changes detected, positions preserved')
      }
    } catch (error) {
      logger.error('Failed to fetch workflow from database:', error)
    } finally {
      // Always release the sync lock
      isSyncingRef.current = false
    }
  }, [enabled, activeWorkflowId, minSyncInterval, session, workflowStore])

  // Handle tab visibility changes
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleVisibilityChange = () => {
      // Only sync when tab becomes visible
      if (document.visibilityState === 'visible') {
        logger.debug('Tab became visible - triggering structural sync check')
        const timeoutId = setTimeout(() => {
          fetchWorkflowFromDB()
        }, 300) // Longer delay to allow operations to complete
        timeoutRefs.current.push(timeoutId)
      }
    }

    // Handle window focus as a fallback
    const handleWindowFocus = () => {
      logger.debug('Window focused - triggering structural sync check')
      const timeoutId = setTimeout(() => {
        fetchWorkflowFromDB()
      }, 300)
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
  }, [enabled, fetchWorkflowFromDB])

  // Return simple sync interface
  return {
    fetchWorkflowFromDB,
    lastSyncTime: lastSyncRef.current,
  }
}

// Global trigger for testing
if (typeof window !== 'undefined') {
  ;(window as any).testTabSync = () => {
    logger.info('Manual tab sync triggered for testing')
    window.dispatchEvent(new Event('focus'))
  }
}
