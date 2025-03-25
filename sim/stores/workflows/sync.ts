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

const logger = createLogger('Workflows Sync')

// Add debounce utility
let syncDebounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_DELAY = 500; // 500ms delay

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
    // Set flag to prevent sync back to DB during loading
    isLoadingFromDB = true
    loadingFromDBToken = 'loading'
    loadingFromDBStartTime = Date.now()

    // Call the API endpoint to get workflows from DB
    const response = await fetch(API_ENDPOINTS.WORKFLOW, {
      method: 'GET',
    })

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('User not authenticated for workflow fetch')
        return
      }

      logger.error('Failed to fetch workflows:', response.statusText)
      return
    }

    const { data } = await response.json()

    if (!data || !Array.isArray(data) || data.length === 0) {
      logger.info('No workflows found in database')
      return
    }

    // Get the current active workflow ID before processing
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

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
      } = workflow

      // 1. Update registry store with workflow metadata
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        // Use createdAt for sorting if available, otherwise fall back to lastSynced
        lastModified: createdAt ? new Date(createdAt) : new Date(lastSynced),
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

      // 6. If this is the active workflow, update the workflow store
      if (id === activeWorkflowId) {
        useWorkflowStore.setState(workflowState)
      }
    })

    // 8. Update registry store with all workflows
    useWorkflowRegistry.setState({ workflows: registryWorkflows })

    // 9. If there's an active workflow that wasn't in the DB data, set a new active workflow
    if (activeWorkflowId && !registryWorkflows[activeWorkflowId]) {
      const firstWorkflowId = Object.keys(registryWorkflows)[0]
      if (firstWorkflowId) {
        // Load the first workflow as active
        const workflowState = JSON.parse(
          localStorage.getItem(`workflow-${firstWorkflowId}`) || '{}'
        )
        if (Object.keys(workflowState).length > 0) {
          useWorkflowStore.setState(workflowState)
          useWorkflowRegistry.setState({ activeWorkflowId: firstWorkflowId })
        }
      }
    }

    logger.info('Workflows loaded from DB:', Object.keys(registryWorkflows).length)
  } catch (error) {
    logger.error('Error fetching workflows from DB:', { error })
  } finally {
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      isLoadingFromDB = false
      loadingFromDBToken = null

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
  endpoint: API_ENDPOINTS.WORKFLOW,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    // Skip sync if we're currently loading from DB to prevent overwriting DB data
    if (isActivelyLoadingFromDB()) {
      logger.info('Skipping workflow sync while loading from DB')
      return { skipSync: true }
    }

    // Get all workflows with values
    const workflowsData = getAllWorkflowsWithValues()

    // Skip sync if there are no workflows to sync
    if (Object.keys(workflowsData).length === 0) {
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

    return {
      workflows: workflowsData,
    }
  },
  method: 'POST' as const,
  syncOnInterval: true,
  syncOnExit: true,
  onSyncSuccess: async () => {
    logger.info('Workflows synced to DB successfully')
  },
};

// Create the sync manager
const baseWorkflowSync = createSingletonSyncManager('workflow-sync', () => workflowSyncConfig);

// Create a debounced version of the sync manager
export const workflowSync = {
  ...baseWorkflowSync,
  sync: () => {
    // Clear any existing timeout
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
    }
    
    // Set new timeout
    syncDebounceTimer = setTimeout(() => {
      // Perform the sync
      baseWorkflowSync.sync();
      
      // Update the last sync timestamp
      if (typeof window !== 'undefined') {
        localStorage.setItem('last_db_sync_timestamp', Date.now().toString());
      }
    }, DEBOUNCE_DELAY);
  }
};
