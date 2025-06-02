'use client'

import { createLogger } from '@/lib/logs/console-logger'
import { API_ENDPOINTS } from '../constants'
import { createSingletonSyncManager } from '../sync'
import { getAllWorkflowsWithValues } from '.'
import { useWorkflowRegistry } from './registry/store'
import type { WorkflowMetadata } from './registry/types'
import { useSubBlockStore } from './subblock/store'
import { useWorkflowStore } from './workflow/store'
import type { BlockState } from './workflow/types'

const logger = createLogger('WorkflowsSync')

// Add debounce utility
let syncDebounceTimer: NodeJS.Timeout | null = null
const DEBOUNCE_DELAY = 500 // 500ms delay

// Flag to prevent immediate sync back to DB after loading from DB
let _isLoadingFromDB = false
let loadingFromDBToken: string | null = null
let loadingFromDBStartTime = 0
const LOADING_TIMEOUT = 3000 // 3 seconds maximum loading time

// Add registry initialization tracking
let registryFullyInitialized = false
const _REGISTRY_INIT_TIMEOUT = 10000 // 10 seconds maximum for registry initialization

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
 * Checks if the workflow registry is fully initialized
 * This is used to prevent syncs before the registry is ready
 * @returns true if registry is initialized, false otherwise
 */
export function isRegistryInitialized(): boolean {
  return registryFullyInitialized
}

/**
 * Marks registry as initialized after successful load
 * Should be called only after all workflows have been loaded from DB
 */
function setRegistryInitialized(): void {
  registryFullyInitialized = true
  logger.info('Workflow registry fully initialized')
}

/**
 * Reset registry initialization state when needed (e.g., workspace switch, logout)
 */
export function resetRegistryInitialization(): void {
  registryFullyInitialized = false
  logger.info('Workflow registry initialization reset')
}

// Enhanced workflow state tracking
let lastWorkflowState: Record<string, any> = {}
let isDirty = false

/**
 * Checks if workflow state has actually changed since last sync
 * @param currentState Current workflow state to compare
 * @returns true if changes detected, false otherwise
 */
function hasWorkflowChanges(currentState: Record<string, any>): boolean {
  if (!currentState || Object.keys(currentState).length === 0) {
    return false // Empty state should not trigger sync
  }

  if (Object.keys(lastWorkflowState).length === 0) {
    // First time check, mark as changed
    lastWorkflowState = JSON.parse(JSON.stringify(currentState))
    return true
  }

  // Check if workflow count changed
  if (Object.keys(currentState).length !== Object.keys(lastWorkflowState).length) {
    lastWorkflowState = JSON.parse(JSON.stringify(currentState))
    return true
  }

  // Deep comparison of workflow states
  let hasChanges = false
  for (const [id, workflow] of Object.entries(currentState)) {
    if (
      !lastWorkflowState[id] ||
      JSON.stringify(workflow) !== JSON.stringify(lastWorkflowState[id])
    ) {
      hasChanges = true
      break
    }
  }

  if (hasChanges) {
    lastWorkflowState = JSON.parse(JSON.stringify(currentState))
  }

  return hasChanges
}

/**
 * Mark workflows as dirty (changed) to force a sync
 */
export function markWorkflowsDirty(): void {
  isDirty = true
  logger.info('Workflows marked as dirty, will sync on next opportunity')
}

/**
 * Checks if workflows are currently marked as dirty
 * @returns true if workflows are dirty and need syncing
 */
export function areWorkflowsDirty(): boolean {
  return isDirty
}

/**
 * Reset the dirty flag after a successful sync
 */
export function resetDirtyFlag(): void {
  isDirty = false
}

/**
 * Fetches workflows from the database and updates the local stores
 * This function handles backwards syncing on initialization
 */
export async function fetchWorkflowsFromDB(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Reset registry initialization state
    resetRegistryInitialization()

    // Set loading state in registry
    useWorkflowRegistry.getState().setLoading(true)

    // Set flag to prevent sync back to DB during loading
    _isLoadingFromDB = true
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

      // Mark registry as initialized even with empty data
      setRegistryInitialized()
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
        parallels: state.parallels || {},
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

    // Capture initial state for change detection
    lastWorkflowState = getAllWorkflowsWithValues()

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

    // Mark registry as fully initialized now that all data is loaded
    setRegistryInitialized()
  } catch (error) {
    logger.error('Error fetching workflows from DB:', { error })

    // Mark registry as initialized even on error to allow fallback mechanisms
    setRegistryInitialized()
  } finally {
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      _isLoadingFromDB = false
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
          isDirty = true // Explicitly mark as dirty for first sync
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
  return isDirty
}

// Create the basic sync configuration
const workflowSyncConfig = {
  endpoint: API_ENDPOINTS.SYNC,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    // Skip sync if registry is not fully initialized yet
    if (!isRegistryInitialized()) {
      logger.info('Skipping workflow sync while registry is not fully initialized')
      return { skipSync: true }
    }

    // Skip sync if we're currently loading from DB to prevent overwriting DB data
    if (isActivelyLoadingFromDB()) {
      logger.info('Skipping workflow sync while loading from DB')
      return { skipSync: true }
    }

    // Get all workflows with values
    const allWorkflowsData = getAllWorkflowsWithValues()

    // Only sync if there are actually changes
    if (!isDirty && !hasWorkflowChanges(allWorkflowsData)) {
      logger.info('Skipping workflow sync - no changes detected')
      return { skipSync: true }
    }

    // Reset dirty flag since we're about to sync
    resetDirtyFlag()

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
}

// Create the sync manager
const baseWorkflowSync = createSingletonSyncManager('workflow-sync', () => workflowSyncConfig)

// Create a debounced version of the sync manager
export const workflowSync = {
  ...baseWorkflowSync,
  sync: () => {
    // Skip sync if not initialized
    if (!isRegistryInitialized()) {
      logger.info('Sync requested but registry not fully initialized yet - delaying')
      // If we're not initialized, mark dirty and check again later
      isDirty = true
      return
    }

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
