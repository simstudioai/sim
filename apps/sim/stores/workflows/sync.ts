'use client'

import { createLogger } from '@/lib/logs/console-logger'
import { getAllWorkflowsWithValues } from '.'
import { API_ENDPOINTS } from '../constants'
import { createSingletonSyncManager } from '../sync'
import { useWorkflowRegistry } from './registry/store'
import { WorkflowMetadata } from './registry/types'
import { useSubBlockStore } from './subblock/store'
import { useWorkflowStore } from './workflow/store'
import { BlockState } from './workflow/types'

const logger = createLogger('WorkflowsSync')

// Add debounce utility
let syncDebounceTimer: NodeJS.Timeout | null = null
const DEBOUNCE_DELAY = 500 // 500ms delay

// Flag to prevent immediate sync back to DB after loading from DB
let isLoadingFromDB = false
let loadingFromDBToken: string | null = null
let loadingFromDBStartTime = 0
const LOADING_TIMEOUT = 3000 // 3 seconds maximum loading time

/**
 * Checks if the system is currently in the process of loading data from the database
 * Includes safety timeout to prevent permanent blocking of syncs
 * @returns true if loading is active, false otherwise
 */
export function isActivelyLoadingFromDB(): boolean {
  if (!loadingFromDBToken) return false

  // Safety check: ensure loading doesn't block syncs indefinitely
  const elapsedTime = Date.now() - loadingFromDBStartTime
  if (elapsedTime > LOADING_TIMEOUT) {
    loadingFromDBToken = null
    return false
  }

  return true
}

/**
 * Fetches workflows from the database and updates the local stores
 * This function handles backwards syncing on initialization
 */
export async function fetchWorkflowsFromDB(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Set loading state in registry
    useWorkflowRegistry.getState().setLoading(true)

    // Set flag to prevent sync back to DB during loading
    isLoadingFromDB = true
    loadingFromDBToken = 'loading'
    loadingFromDBStartTime = Date.now()

    // Get active workspace ID to filter workflows
    const activeWorkspaceId = useWorkflowRegistry.getState().activeWorkspaceId

    // Call the API endpoint to get workflows from DB with workspace filter
    const url = new URL(API_ENDPOINTS.SYNC, window.location.origin)
    if (activeWorkspaceId) {
      url.searchParams.append('workspaceId', activeWorkspaceId)
      logger.info(`Fetching workflows for workspace: ${activeWorkspaceId}`)
    } else {
      logger.info('Fetching workflows without workspace filter')
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
    })

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('User not authenticated for workflow fetch')
        return
      }

      // Handle case when workspace not found
      if (response.status === 404) {
        const responseData = await response.json()
        if (responseData.code === 'WORKSPACE_NOT_FOUND' && activeWorkspaceId) {
          logger.warn(`Workspace ${activeWorkspaceId} not found, it may have been deleted`)

          // Fetch user's available workspaces to switch to a valid one
          const workspacesResponse = await fetch('/api/workspaces', { method: 'GET' })
          if (workspacesResponse.ok) {
            const { workspaces } = await workspacesResponse.json()

            if (workspaces && workspaces.length > 0) {
              // Switch to the first available workspace
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
        `No workflows found in database for ${activeWorkspaceId ? `workspace ${activeWorkspaceId}` : 'user'}`
      )
      // Clear any existing workflows to ensure a clean state
      useWorkflowRegistry.setState({ workflows: {} })
      return
    }

    // Process workflows and update stores
    const registryWorkflows: Record<string, WorkflowMetadata> = {}

    // Process each workflow from the database
    data.forEach((workflow) => {
      const {
        id,
        name,
        description,
        color,
        state,
        lastSynced,
        isDeployed,
        deployedAt,
        apiKey,
        createdAt,
        marketplaceData,
        workspaceId, // Extract workspaceId
      } = workflow

      // Ensure this workflow belongs to the current workspace
      if (activeWorkspaceId && workspaceId !== activeWorkspaceId) {
        logger.warn(
          `Skipping workflow ${id} as it belongs to workspace ${workspaceId}, not the active workspace ${activeWorkspaceId}`
        )
        return
      }

      // 1. Update registry store with workflow metadata
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        // Use createdAt for sorting if available, otherwise fall back to lastSynced
        lastModified: createdAt ? new Date(createdAt) : new Date(lastSynced),
        marketplaceData: marketplaceData || null,
        workspaceId, // Include workspaceId in metadata
      }

      // 2. Prepare workflow state data
      const workflowState = {
        blocks: state.blocks || {},
        edges: state.edges || [],
        loops: state.loops || {},
        isDeployed: isDeployed || false,
        deployedAt: deployedAt ? new Date(deployedAt) : undefined,
        apiKey,
        lastSaved: Date.now(),
        marketplaceData: marketplaceData || null,
      }

      // 3. Initialize subblock values from the workflow state
      const subblockValues: Record<string, Record<string, any>> = {}

      // Extract subblock values from blocks
      Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
        const blockState = block as BlockState
        subblockValues[blockId] = {}

        Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
          subblockValues[blockId][subblockId] = subblock.value
        })
      })

      // Get any additional subblock values that might not be in the state but are in the store
      const storedValues = useSubBlockStore.getState().workflowValues[id] || {}
      Object.entries(storedValues).forEach(([blockId, blockValues]) => {
        if (!subblockValues[blockId]) {
          subblockValues[blockId] = {}
        }

        Object.entries(blockValues).forEach(([subblockId, value]) => {
          // Only update if not already set or if value is null
          if (
            subblockValues[blockId][subblockId] === null ||
            subblockValues[blockId][subblockId] === undefined
          ) {
            subblockValues[blockId][subblockId] = value
          }
        })
      })

      // 4. Store the workflow state and subblock values in localStorage
      // This ensures compatibility with existing code that loads from localStorage
      localStorage.setItem(`workflow-${id}`, JSON.stringify(workflowState))
      localStorage.setItem(`subblock-values-${id}`, JSON.stringify(subblockValues))

      // 5. Update subblock store for this workflow
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [id]: subblockValues,
        },
      }))
    })

    logger.info(
      `Loaded ${Object.keys(registryWorkflows).length} workflows for ${activeWorkspaceId ? `workspace ${activeWorkspaceId}` : 'user'}`
    )

    // 8. Update registry store with all workflows
    useWorkflowRegistry.setState({ workflows: registryWorkflows })

    // 9. Set the first workflow as active if there's no active workflow
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId && Object.keys(registryWorkflows).length > 0) {
      const firstWorkflowId = Object.keys(registryWorkflows)[0]

      // Load the first workflow as active
      const workflowState = JSON.parse(localStorage.getItem(`workflow-${firstWorkflowId}`) || '{}')

      if (Object.keys(workflowState).length > 0) {
        useWorkflowStore.setState(workflowState)
        useWorkflowRegistry.setState({ activeWorkflowId: firstWorkflowId })
        logger.info(`Set first workflow ${firstWorkflowId} as active`)
      }
    }
  } catch (error) {
    logger.error('Error fetching workflows from DB:', { error })
  } finally {
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      isLoadingFromDB = false
      loadingFromDBToken = null

      // Set loading state to false
      useWorkflowRegistry.getState().setLoading(false)

      // Verify if registry has workflows as a final check
      const registryWorkflows = useWorkflowRegistry.getState().workflows
      const workflowCount = Object.keys(registryWorkflows).length
      logger.info(`DB loading complete. Workflows in registry: ${workflowCount}`)

      // Only trigger a final sync if necessary (don't do this for normal loads)
      // This helps reduce unnecessary POST requests
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (workflowCount > 0 && activeWorkflowId && activeDBSyncNeeded()) {
        // Small delay for state to fully settle before allowing syncs
        setTimeout(() => {
          workflowSync.sync()
        }, 500)
      }
    }, 1000) // Increased to 1 second for more reliable state settling
  }
}

// Helper to determine if an active DB sync is actually needed
function activeDBSyncNeeded(): boolean {
  // In most cases after initial load, we don't need to sync back to DB
  // Only sync if we have detected a change that needs to be persisted
  const lastSynced = localStorage.getItem('last_db_sync_timestamp')
  const currentTime = Date.now()

  if (!lastSynced) {
    // First sync - record it and return true
    localStorage.setItem('last_db_sync_timestamp', currentTime.toString())
    return true
  }

  // Add additional checks here if needed for specific workflow changes
  // For now, we'll simply avoid the automatic sync after load
  return false
}

// Create the basic sync configuration
const workflowSyncConfig = {
  endpoint: API_ENDPOINTS.SYNC,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    // Skip sync if we're currently loading from DB to prevent overwriting DB data
    if (isActivelyLoadingFromDB()) {
      logger.info('Skipping workflow sync while loading from DB')
      return { skipSync: true }
    }

    // Get all workflows with values
    const allWorkflowsData = getAllWorkflowsWithValues()

    // Get the active workspace ID
    const activeWorkspaceId = useWorkflowRegistry.getState().activeWorkspaceId

    // Skip sync if there are no workflows to sync
    if (Object.keys(allWorkflowsData).length === 0) {
      // Safety check: if registry has workflows but we're sending empty data, something is wrong
      const registryWorkflows = useWorkflowRegistry.getState().workflows
      if (Object.keys(registryWorkflows).length > 0) {
        logger.warn(
          'Potential data loss prevented: Registry has workflows but sync payload is empty'
        )
        return { skipSync: true }
      }

      logger.info('Skipping workflow sync - no workflows to sync')
      return { skipSync: true }
    }

    // Filter out any workflows associated with workspaces other than the active one
    // This prevents foreign key constraint errors when a workspace has been deleted
    const workflowsData: Record<string, any> = {}
    Object.entries(allWorkflowsData).forEach(([id, workflow]) => {
      // Include workflows if:
      // 1. They match the active workspace, OR
      // 2. They don't have a workspace ID (legacy workflows)
      if (workflow.workspaceId === activeWorkspaceId || !workflow.workspaceId) {
        // For workflows without workspace ID, assign the active workspace ID
        if (!workflow.workspaceId) {
          workflow.workspaceId = activeWorkspaceId
          logger.info(`Assigning workspace ${activeWorkspaceId} to orphaned workflow ${id}`)
        }
        workflowsData[id] = workflow
      } else {
        logger.warn(
          `Skipping sync for workflow ${id} - associated with non-active workspace ${workflow.workspaceId}`
        )
      }
    })

    // Skip sync if after filtering there are no workflows to sync
    if (Object.keys(workflowsData).length === 0) {
      logger.info('Skipping workflow sync - no workflows for active workspace to sync')
      return { skipSync: true }
    }

    // Always include the workspace ID in the payload for correct DB filtering
    return {
      workflows: workflowsData,
      workspaceId: activeWorkspaceId, // Include active workspace ID in the payload
    }
  },
  method: 'POST' as const,
  syncOnInterval: true,
  syncOnExit: true,
  onSyncSuccess: async () => {
    logger.info('Workflows synced to DB successfully')
  },
}

// Create the sync manager
const baseWorkflowSync = createSingletonSyncManager('workflow-sync', () => workflowSyncConfig)

// Create a debounced version of the sync manager
export const workflowSync = {
  ...baseWorkflowSync,
  sync: () => {
    // Clear any existing timeout
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer)
    }

    // Set new timeout
    syncDebounceTimer = setTimeout(() => {
      // Perform the sync
      baseWorkflowSync.sync()

      // Update the last sync timestamp
      if (typeof window !== 'undefined') {
        localStorage.setItem('last_db_sync_timestamp', Date.now().toString())
      }
    }, DEBOUNCE_DELAY)
  },
}
