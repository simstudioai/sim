import { SyncManager, createSyncManager } from '@/stores/sync'
import { useWorkflowRegistry } from './registry/store'
import { mergeSubblockState } from './utils'
import { useWorkflowStore } from './workflow/store'

// API endpoint for workflow operations
const WORKFLOW_ENDPOINT = '/api/db/workflow'

/**
 * Prepares the workflow payload for syncing
 * Combines registry metadata with workflow state
 */
const prepareWorkflowPayload = () => {
  const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()

  if (!activeWorkflowId || !workflows[activeWorkflowId]) {
    return null
  }

  const workflowState = useWorkflowStore.getState()
  const metadata = workflows[activeWorkflowId]

  // Merge subblock values into the blocks for complete state
  const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId)

  return {
    id: activeWorkflowId,
    name: metadata.name,
    description: metadata.description,
    color: metadata.color,
    state: {
      blocks: mergedBlocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      lastSaved: workflowState.lastSaved,
      isDeployed: workflowState.isDeployed,
      deployedAt: workflowState.deployedAt,
    },
  }
}

/**
 * Creates a sync manager instance for the active workflow
 * This sync manager is designed for event-based syncing with debouncing
 */
export const workflowSyncManager: SyncManager = createSyncManager({
  endpoint: WORKFLOW_ENDPOINT,
  preparePayload: prepareWorkflowPayload,
  syncInterval: null, // No interval syncing for now
  syncOnExit: true, // Sync on exit to prevent data loss

  // Configure debouncing for workflow sync
  debounce: {
    delay: 2000, // 2 seconds delay for workflow changes
    maxWait: 10000, // Maximum 10 seconds before forced sync
  },

  // Optional handlers
  onSyncSuccess: () => {
    console.debug('Workflow synced successfully')
  },
  onSyncError: (error) => {
    console.error('Failed to sync workflow:', error)
  },

  // Only sync if there's an active workflow
  shouldSync: () => {
    const { activeWorkflowId } = useWorkflowRegistry.getState()
    return !!activeWorkflowId
  },
})

/**
 * Syncs the current workflow with the database
 * Uses optimistic updates - doesn't wait for server response
 */
export function syncWorkflow(): void {
  workflowSyncManager.fireAndForgetSync()
}

/**
 * Syncs the current workflow with the database using debouncing
 * Returns a promise for cases where you need to know the result
 */
export async function syncWorkflowDebounced(): Promise<boolean> {
  return workflowSyncManager.debouncedSync()
}

/**
 * Syncs the current workflow immediately without debouncing
 * Returns a promise for cases where you need to know the result
 */
export async function syncWorkflowImmediate(): Promise<boolean> {
  return workflowSyncManager.sync()
}

/**
 * Prepares a specific workflow for syncing by ID
 * Used for registry operations that need to sync a specific workflow
 */
const prepareSpecificWorkflowPayload = (workflowId: string) => {
  const { workflows } = useWorkflowRegistry.getState()

  if (!workflowId || !workflows[workflowId]) {
    return null
  }

  // Load workflow state from localStorage
  const workflowStateKey = `workflow-${workflowId}`
  const savedState = localStorage.getItem(workflowStateKey)

  if (!savedState) {
    return null
  }

  const state = JSON.parse(savedState)
  const metadata = workflows[workflowId]

  // Merge subblock values into the blocks for complete state
  const mergedBlocks = mergeSubblockState(state.blocks, workflowId)

  return {
    id: workflowId,
    name: metadata.name,
    description: metadata.description,
    color: metadata.color,
    state: {
      blocks: mergedBlocks,
      edges: state.edges,
      loops: state.loops,
      lastSaved: state.lastSaved,
      isDeployed: state.isDeployed,
      deployedAt: state.deployedAt,
    },
  }
}

/**
 * Creates a sync manager for a specific workflow by ID
 */
export function createWorkflowSyncManager(workflowId: string): SyncManager {
  return createSyncManager({
    endpoint: WORKFLOW_ENDPOINT,
    preparePayload: () => prepareSpecificWorkflowPayload(workflowId),
    syncInterval: null,
    syncOnExit: false,
    debounce: true, // Use default debounce settings
    onSyncSuccess: () => {
      console.debug(`Workflow ${workflowId} synced successfully`)
    },
    onSyncError: (error) => {
      console.error(`Failed to sync workflow ${workflowId}:`, error)
    },
    shouldSync: () => {
      const { workflows } = useWorkflowRegistry.getState()
      return !!workflows[workflowId]
    },
  })
}

/**
 * Syncs a specific workflow with the database by ID
 * Uses optimistic updates - doesn't wait for server response
 */
export function syncSpecificWorkflow(workflowId: string): void {
  const syncManager = createWorkflowSyncManager(workflowId)
  syncManager.fireAndForgetSync()
}

/**
 * Syncs a specific workflow with the database by ID
 * Returns a promise for cases where you need to know the result
 */
export async function syncSpecificWorkflowWithResult(workflowId: string): Promise<boolean> {
  const syncManager = createWorkflowSyncManager(workflowId)
  return syncManager.sync()
}

/**
 * Syncs a workflow deletion with the database
 * Uses optimistic updates - doesn't wait for server response
 */
export function syncWorkflowDeletion(workflowId: string): void {
  // Use setTimeout to move the operation to the next event loop tick
  setTimeout(() => {
    fetch(WORKFLOW_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: workflowId }),
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) {
          if (response.status === 401) {
            console.error('Authentication required for workflow deletion')
            return
          }
          throw new Error(`Workflow deletion sync failed: ${response.statusText}`)
        }
        console.debug(`Workflow ${workflowId} deleted successfully`)
      })
      .catch((error) => {
        console.error(`Failed to sync workflow deletion for ${workflowId}:`, error)
      })
  }, 0)
}
