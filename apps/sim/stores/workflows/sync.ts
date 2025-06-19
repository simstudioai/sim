'use client'

import { createLogger } from '@/lib/logs/console-logger'
import { API_ENDPOINTS } from '../constants'
import { isDataInitialized } from '../index'
import { createSingletonSyncManager } from '../sync'
import { getAllWorkflowsWithValues } from '.'
import { isWorkspaceInTransition, useWorkflowRegistry } from './registry/store'
import type { WorkflowMetadata } from './registry/types'
import { useSubBlockStore } from './subblock/store'
import type { BlockState } from './workflow/types'

const logger = createLogger('WorkflowsSync')

// Simplified sync state tracking
let lastSyncedData = ''
let isSyncing = false
let isFetching = false // Add lock to prevent concurrent fetches
let lastFetchTimestamp = 0 // Track when we last fetched to prevent race conditions

/**
 * Simplified workflow sync - no more complex flags and initialization checks
 */
const workflowSyncConfig = {
  endpoint: API_ENDPOINTS.SYNC,
  preparePayload: () => {
    if (typeof window === 'undefined') return { skipSync: true }

    // Skip sync if data is not yet initialized from database
    if (!isDataInitialized()) {
      logger.info('Skipping sync: Data not yet initialized from database')
      return { skipSync: true }
    }

    // Prevent concurrent syncs
    if (isSyncing) {
      return { skipSync: true }
    }

    // Block sync during workspace transitions to prevent race conditions
    if (isWorkspaceInTransition()) {
      logger.info('Skipping sync: Workspace transition in progress')
      return { skipSync: true }
    }

    // Get all workflows with values
    const allWorkflowsData = getAllWorkflowsWithValues()

    // Skip sync if no workflows
    if (Object.keys(allWorkflowsData).length === 0) {
      return { skipSync: true }
    }

    // Safety check: Never sync if any workflow has empty state
    // A valid workflow should always have at least a start block
    const allWorkflowsHaveBlocks = Object.values(allWorkflowsData).every((workflow) => {
      const blocks = workflow.state?.blocks || {}
      return Object.keys(blocks).length > 0
    })

    if (!allWorkflowsHaveBlocks) {
      logger.warn(
        'Skipping sync: One or more workflows have empty state (no blocks). This indicates corrupted or incomplete workflow data.'
      )
      return { skipSync: true }
    }

    // Skip sync if no changes detected
    const currentDataHash = JSON.stringify(allWorkflowsData)
    if (currentDataHash === lastSyncedData) {
      return { skipSync: true }
    }

    // Update last synced data hash
    lastSyncedData = currentDataHash

    // Get the active workspace ID
    const activeWorkspaceId = useWorkflowRegistry.getState().activeWorkspaceId

    // Ensure all workflows have required fields for validation
    const workflowsData: Record<string, any> = {}
    Object.entries(allWorkflowsData).forEach(([id, workflow]) => {
      // Ensure state has required fields for Zod validation
      const safeWorkflow = {
        ...workflow,
        state: {
          blocks: workflow.state?.blocks || {},
          edges: workflow.state?.edges || [],
          loops: workflow.state?.loops || {},
          parallels: workflow.state?.parallels || {},
          ...workflow.state,
        },
      }

      // Only include workspaceId if it exists
      if (workflow.workspaceId || activeWorkspaceId) {
        safeWorkflow.workspaceId = workflow.workspaceId || activeWorkspaceId
      }

      workflowsData[id] = safeWorkflow
    })

    isSyncing = true

    const payload: any = {
      workflows: workflowsData,
    }

    // Only include workspaceId if it exists (not null/undefined)
    if (activeWorkspaceId) {
      payload.workspaceId = activeWorkspaceId
    }

    return payload
  },
  method: 'POST' as const,
  syncOnInterval: true,
  syncOnExit: true,
  onSyncSuccess: () => {
    isSyncing = false
    logger.info('Workflow sync completed successfully')
  },
  onSyncError: (error: any) => {
    isSyncing = false
    logger.error('Workflow sync failed:', error)
  },
}

// Create the sync manager without debouncing or complex initialization checks
export const workflowSync = createSingletonSyncManager('workflow-sync', () => workflowSyncConfig)

/**
 * Simplified function to fetch workflows from DB
 */
export async function fetchWorkflowsFromDB(): Promise<void> {
  if (typeof window === 'undefined') return

  // Prevent concurrent fetch operations
  if (isFetching) {
    logger.info('Fetch already in progress, skipping duplicate request')
    return
  }

  const fetchStartTime = Date.now()
  isFetching = true

  try {
    useWorkflowRegistry.getState().setLoading(true)

    const activeWorkspaceId = useWorkflowRegistry.getState().activeWorkspaceId
    const url = new URL(API_ENDPOINTS.SYNC, window.location.origin)

    if (activeWorkspaceId) {
      url.searchParams.append('workspaceId', activeWorkspaceId)
    }

    const response = await fetch(url.toString(), { method: 'GET' })

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('User not authenticated for workflow fetch')
        useWorkflowRegistry.setState({ workflows: {}, isLoading: false })
        return
      }
      throw new Error(`Failed to fetch workflows: ${response.statusText}`)
    }

    // Check if this fetch is still relevant (not superseded by a newer fetch)
    if (fetchStartTime < lastFetchTimestamp) {
      logger.info('Fetch superseded by newer operation, discarding results')
      return
    }

    // Update timestamp to mark this as the most recent fetch
    lastFetchTimestamp = fetchStartTime

    const { data } = await response.json()

    if (!data || !Array.isArray(data)) {
      logger.info('No workflows found in database')

      // Only clear workflows if we're confident this is a legitimate empty state
      // Avoid overwriting existing workflows during race conditions
      const currentWorkflows = useWorkflowRegistry.getState().workflows
      const hasExistingWorkflows = Object.keys(currentWorkflows).length > 0

      if (hasExistingWorkflows) {
        logger.warn(
          'Received empty workflow data but local workflows exist - possible race condition, preserving local state'
        )
        useWorkflowRegistry.setState({ isLoading: false })
        return
      }

      useWorkflowRegistry.setState({ workflows: {}, isLoading: false })
      return
    }

    // Process workflows
    const registryWorkflows: Record<string, WorkflowMetadata> = {}
    const deploymentStatuses: Record<string, any> = {}

    data.forEach((workflow) => {
      const {
        id,
        name,
        description,
        color,
        state,
        createdAt,
        templatesData,
        workspaceId,
        folderId,
        isDeployed,
        deployedAt,
        apiKey,
      } = workflow

      // Skip if workflow doesn't belong to active workspace
      if (activeWorkspaceId && workspaceId !== activeWorkspaceId) {
        return
      }

      // Add to registry
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        lastModified: createdAt ? new Date(createdAt) : new Date(),
        templatesData: templatesData || null,
        workspaceId,
        folderId: folderId || null,
      }

      // CRITICAL: Extract deployment status from database and add to registry
      if (isDeployed || deployedAt) {
        deploymentStatuses[id] = {
          isDeployed: isDeployed || false,
          deployedAt: deployedAt ? new Date(deployedAt) : undefined,
          apiKey: apiKey || undefined,
          needsRedeployment: false, // Default to false when loading from DB
        }
      }

      // Initialize subblock values
      const subblockValues: Record<string, Record<string, any>> = {}
      if (state?.blocks) {
        Object.entries(state.blocks).forEach(([blockId, block]) => {
          const blockState = block as BlockState
          subblockValues[blockId] = {}

          Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
            subblockValues[blockId][subblockId] = subblock.value
          })
        })
      }

      // Update subblock store
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [id]: subblockValues,
        },
      }))
    })

    // Update registry with loaded workflows and deployment statuses
    useWorkflowRegistry.setState({
      workflows: registryWorkflows,
      deploymentStatuses: deploymentStatuses,
      isLoading: false,
      error: null,
    })

    // Only set first workflow as active if no active workflow is set and we have workflows
    // This prevents race conditions from overriding an already-set active workflow
    const currentState = useWorkflowRegistry.getState()
    if (!currentState.activeWorkflowId && Object.keys(registryWorkflows).length > 0) {
      const firstWorkflowId = Object.keys(registryWorkflows)[0]
      useWorkflowRegistry.setState({ activeWorkflowId: firstWorkflowId })
      logger.info(`Set first workflow as active: ${firstWorkflowId}`)
    }

    logger.info(
      `Successfully loaded ${Object.keys(registryWorkflows).length} workflows from database`
    )
  } catch (error) {
    logger.error('Error fetching workflows from DB:', error)
    useWorkflowRegistry.setState({
      isLoading: false,
      error: `Failed to load workflows: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    // Re-throw to allow caller to handle the error appropriately
    throw error
  } finally {
    isFetching = false
  }
}

/**
 * Fetch a single workflow state from the database
 */
export async function fetchWorkflowStateFromDB(workflowId: string): Promise<any | null> {
  try {
    const response = await fetch(`/api/workflows/${workflowId}`, { method: 'GET' })

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`Workflow ${workflowId} not found in database`)
        return null
      }
      throw new Error(`Failed to fetch workflow: ${response.statusText}`)
    }

    const { data } = await response.json()
    return data
  } catch (error) {
    logger.error(`Error fetching workflow ${workflowId} from DB:`, error)
    return null
  }
}

/**
 * Mark workflows as dirty for sync
 */
export function markWorkflowsDirty(): void {
  // Force a sync by clearing the last synced data hash
  lastSyncedData = ''
  logger.info('Workflows marked as dirty')
}
