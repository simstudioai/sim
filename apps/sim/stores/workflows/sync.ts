'use client'

import { createLogger } from '@/lib/logs/console-logger'
import { changeTracker, convertGranularToLegacy, type PendingChange } from './granular-sync'
import { useWorkflowRegistry } from './registry/store'
import type { WorkflowMetadata } from './registry/types'
import { useSubBlockStore } from './subblock/store'
import { useWorkflowStore } from './workflow/store'
import type { BlockState } from './workflow/types'

const logger = createLogger('GranularWorkflowsSync')

// Debouncing for sync requests to prevent race conditions
const syncTimeouts = new Map<string, NodeJS.Timeout>()
const SYNC_DEBOUNCE_MS = 500 // 500ms debounce

// Global state tracking
let registryFullyInitialized = false
let isLoadingFromDB = false
let loadingFromDBStartTime = 0
const LOADING_TIMEOUT = 3000

/**
 * Checks if the system is currently loading from database
 */
export function isActivelyLoadingFromDB(): boolean {
  if (!isLoadingFromDB) return false

  const elapsedTime = Date.now() - loadingFromDBStartTime
  if (elapsedTime > LOADING_TIMEOUT) {
    isLoadingFromDB = false
    return false
  }

  return true
}

/**
 * Checks if the workflow registry is fully initialized
 */
export function isRegistryInitialized(): boolean {
  return registryFullyInitialized
}

/**
 * Reset registry initialization state
 */
export function resetRegistryInitialization(): void {
  registryFullyInitialized = false
  logger.info('Workflow registry initialization reset')
}

/**
 * Fetches workflows from database in granular format
 */
export async function fetchWorkflowsFromDB(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    resetRegistryInitialization()
    useWorkflowRegistry.getState().setLoading(true)

    isLoadingFromDB = true
    loadingFromDBStartTime = Date.now()

    const activeWorkspaceId = useWorkflowRegistry.getState().activeWorkspaceId

    // Use the granular sync endpoint for fetching workflows
    const url = new URL('/api/workflows/granular-sync', window.location.origin)
    if (activeWorkspaceId) {
      url.searchParams.append('workspaceId', activeWorkspaceId)
      logger.info(`Fetching workflows for workspace: ${activeWorkspaceId}`)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
    })

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('User not authenticated for workflow fetch')
        return
      }

      if (response.status === 404) {
        const responseData = await response.json()
        if (responseData.code === 'WORKSPACE_NOT_FOUND' && activeWorkspaceId) {
          logger.warn(`Workspace ${activeWorkspaceId} not found`)

          const workspacesResponse = await fetch('/api/workspaces', { method: 'GET' })
          if (workspacesResponse.ok) {
            const { workspaces } = await workspacesResponse.json()
            if (workspaces && workspaces.length > 0) {
              const firstWorkspace = workspaces[0]
              logger.info(`Switching to available workspace: ${firstWorkspace.id}`)
              useWorkflowRegistry.getState().setActiveWorkspace(firstWorkspace.id)
              return
            }
          }
        }
      }

      logger.error('Failed to fetch workflows:', response.statusText)
      return
    }

    const { data } = await response.json()

    if (!data || !Array.isArray(data) || data.length === 0) {
      logger.info(
        `No workflows found for ${activeWorkspaceId ? `workspace ${activeWorkspaceId}` : 'user'}`
      )
      useWorkflowRegistry.setState({ workflows: {} })
      registryFullyInitialized = true
      return
    }

    const registryWorkflows: Record<string, WorkflowMetadata> = {}

    // Process each workflow from granular format
    for (const workflow of data) {
      const {
        id,
        name,
        description,
        color,
        lastSynced,
        isDeployed,
        deployedAt,
        createdAt,
        marketplaceData,
        workspaceId,
        folderId,
        // Granular components
        nodes = [],
        edges = [],
        loops = [],
        parallels = [],
      } = workflow

      if (activeWorkspaceId && workspaceId !== activeWorkspaceId) {
        logger.warn(`Skipping workflow ${id} - wrong workspace`)
        continue
      }

      // Convert granular components to legacy format for local use
      const legacyState = convertGranularToLegacy(nodes, edges, loops, parallels)

      // Update registry metadata
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        lastModified: createdAt ? new Date(createdAt) : new Date(lastSynced),
        marketplaceData: marketplaceData || null,
        workspaceId,
        folderId: folderId || null,
      }

      // Prepare workflow state for local use
      const workflowState = {
        blocks: legacyState.blocks || {},
        edges: legacyState.edges || [],
        loops: legacyState.loops || {},
        parallels: legacyState.parallels || {},
        isDeployed: isDeployed || false,
        deployedAt: deployedAt ? new Date(deployedAt) : undefined,
        lastSaved: Date.now(),
        marketplaceData: marketplaceData || null,
      }

      // Extract subblock values
      const subblockValues: Record<string, Record<string, any>> = {}
      Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
        const blockState = block as BlockState
        subblockValues[blockId] = {}
        Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
          subblockValues[blockId][subblockId] = subblock.value
        })
      })

      // Store in localStorage for backward compatibility
      localStorage.setItem(`workflow-${id}`, JSON.stringify(workflowState))
      localStorage.setItem(`subblock-values-${id}`, JSON.stringify(subblockValues))

      // Update subblock store
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [id]: subblockValues,
        },
      }))

      // Start tracking changes for this workflow
      changeTracker.startTracking(id)
    }

    logger.info(`Loaded ${Object.keys(registryWorkflows).length} workflows with granular sync`)

    // Update registry
    useWorkflowRegistry.setState({ workflows: registryWorkflows })

    // Set first workflow as active if needed
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId && Object.keys(registryWorkflows).length > 0) {
      const firstWorkflowId = Object.keys(registryWorkflows)[0]
      const workflowState = JSON.parse(localStorage.getItem(`workflow-${firstWorkflowId}`) || '{}')

      if (Object.keys(workflowState).length > 0) {
        useWorkflowStore.setState(workflowState)
        useWorkflowRegistry.setState({ activeWorkflowId: firstWorkflowId })
        logger.info(`Set first workflow ${firstWorkflowId} as active`)
      }
    }

    registryFullyInitialized = true
    logger.info('Registry fully initialized with granular sync')
  } catch (error) {
    logger.error('Error fetching workflows from DB:', { error })
    registryFullyInitialized = true
  } finally {
    setTimeout(() => {
      isLoadingFromDB = false
      useWorkflowRegistry.getState().setLoading(false)
      logger.info('DB loading complete')
    }, 1000)
  }
}

/**
 * Sync a specific workflow using direct granular API calls (immediate, no debouncing)
 */
async function syncWorkflowImmediate(workflowId: string): Promise<boolean> {
  if (!isRegistryInitialized() || isActivelyLoadingFromDB()) {
    logger.info(`Skipping sync for ${workflowId} - not ready`)
    return false
  }

  try {
    // Check if there are changes to sync
    if (!changeTracker.hasChanges(workflowId)) {
      logger.debug(`No changes to sync for workflow ${workflowId}`)
      return true
    }

    const pendingChanges = changeTracker.getPendingChanges(workflowId)
    logger.info(`Syncing ${pendingChanges.length} changes for workflow ${workflowId}`)

    // Get workflow metadata from registry
    const registry = useWorkflowRegistry.getState()
    const workflowMetadata = registry.workflows[workflowId]

    // Get workflow state from localStorage
    const workflowStateStr = localStorage.getItem(`workflow-${workflowId}`)
    const workflowState = workflowStateStr ? JSON.parse(workflowStateStr) : null

    // Prepare sync payload with metadata for creation if needed
    const payload = {
      workflowId,
      workspaceId: registry.activeWorkspaceId,
      clientId: changeTracker.getClientId(),
      sessionId: changeTracker.getSessionId(),
      workflowMetadata:
        workflowMetadata && workflowState
          ? {
              name: workflowMetadata.name,
              description: workflowMetadata.description,
              color: workflowMetadata.color,
              folderId: workflowMetadata.folderId,
              marketplaceData: workflowMetadata.marketplaceData,
              state: workflowState,
            }
          : undefined,
      changes: changeTracker.getGroupedChanges(workflowId),
    }

    // Send sync request directly to granular API
    const response = await fetch('/api/workflows/granular-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      logger.error(
        `Sync failed for workflow ${workflowId}: ${response.status} ${response.statusText}`
      )
      return false
    }

    const result = await response.json()

    if (result.success) {
      // Clear pending changes on successful sync
      changeTracker.clearPendingChanges(workflowId)
      logger.info(`Successfully synced workflow ${workflowId}`)
      return true
    }
    logger.error(`Sync failed for workflow ${workflowId}:`, result.error)
    return false
  } catch (error) {
    logger.error(`Error syncing workflow ${workflowId}:`, error)
    return false
  }
}

/**
 * Debounced sync function to prevent race conditions
 */
export function syncWorkflow(workflowId: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Clear existing timeout for this workflow
    const existingTimeout = syncTimeouts.get(workflowId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Set new debounced timeout
    const timeout = setTimeout(async () => {
      syncTimeouts.delete(workflowId)
      const result = await syncWorkflowImmediate(workflowId)
      resolve(result)
    }, SYNC_DEBOUNCE_MS)

    syncTimeouts.set(workflowId, timeout)
  })
}

/**
 * Sync all workflows using granular API
 */
export async function syncAllWorkflows(): Promise<void> {
  if (!isRegistryInitialized() || isActivelyLoadingFromDB()) {
    logger.info('Skipping sync all - not ready')
    return
  }

  const workflows = useWorkflowRegistry.getState().workflows
  const workflowIds = Object.keys(workflows)

  if (workflowIds.length === 0) {
    logger.info('No workflows to sync')
    return
  }

  logger.info(`Syncing ${workflowIds.length} workflows`)

  // Use debounced sync instead of immediate sync to prevent race conditions
  const syncPromises = workflowIds.map((id) => syncWorkflow(id))
  const results = await Promise.allSettled(syncPromises)

  const successful = results.filter((r) => r.status === 'fulfilled' && r.value).length
  const failed = results.length - successful

  logger.info(`Sync complete: ${successful} successful, ${failed} failed`)
}

/**
 * Get changes for a specific workflow
 */
export function getWorkflowChanges(workflowId: string): PendingChange[] {
  return changeTracker.getPendingChanges(workflowId)
}

/**
 * Check if a workflow has unsaved changes
 */
export function hasUnsavedChanges(workflowId: string): boolean {
  return changeTracker.hasChanges(workflowId)
}

/**
 * Mark workflows as dirty (legacy compatibility)
 */
export function markWorkflowsDirty(): void {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (activeWorkflowId) {
    logger.info('Active workflow will be tracked for changes')
  }
}

/**
 * Check if workflows are dirty (legacy compatibility)
 */
export function areWorkflowsDirty(): boolean {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) return false

  return hasUnsavedChanges(activeWorkflowId)
}

/**
 * Reset dirty flag (legacy compatibility)
 */
export function resetDirtyFlag(): void {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (activeWorkflowId) {
    changeTracker.clearPendingChanges(activeWorkflowId)
  }
}

/**
 * Main workflow sync interface (granular format only)
 */
export const workflowSync = {
  config: {
    syncOnExit: true,
  },

  sync: () => {
    if (!isRegistryInitialized()) {
      logger.info('Sync requested but registry not initialized - delaying')
      return
    }

    // Use debounced sync for better performance and to prevent race conditions
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId) {
      // For general sync calls, only sync the active workflow with debouncing
      syncWorkflow(activeWorkflowId).catch((error) => {
        logger.error('Failed to sync active workflow:', error)
      })
    } else {
      // If no active workflow, sync all (this is rare)
      syncAllWorkflows().catch((error) => {
        logger.error('Failed to sync workflows:', error)
      })
    }
  },

  syncWorkflow: (workflowId: string) => {
    // Use debounced sync for consistency, except for explicit exit calls
    return syncWorkflow(workflowId)
  },

  syncWorkflowImmediate: (workflowId: string) => {
    // Keep immediate sync available for exit handlers and critical operations
    return syncWorkflowImmediate(workflowId)
  },

  startIntervalSync: () => {
    logger.info('Granular sync ready - event-driven mode')
  },

  stopIntervalSync: () => {
    logger.info('Granular sync stopped')
  },

  dispose: () => {
    // Clear all pending sync timeouts
    for (const [workflowId, timeout] of syncTimeouts.entries()) {
      clearTimeout(timeout)
    }
    syncTimeouts.clear()
    logger.info('Granular sync disposed - cleared all pending syncs')
  },
}
