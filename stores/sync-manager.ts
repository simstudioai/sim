import { useWorkflowRegistry } from './workflow/registry/store'
import { BlockState } from './workflow/types'
import { mergeSubblockState } from './workflow/utils'

// Type definitions
interface WorkflowSyncPayload {
  id: string
  name: string
  description?: string
  state: {
    blocks: Record<string, BlockState>
    edges: any
    loops: any
    lastSaved: any
  }
}

// API configuration
const SYNC_INTERVAL_MS = 30000
const API_ENDPOINTS = {
  SYNC: '/api/db/sync',
  FETCH: '/api/db/fetch',
  SCHEDULE: '/api/scheduled/schedule',
  LOGIN: '/login',
} as const

// Global state
const deletedWorkflowIds = new Set<string>()
let syncInterval: NodeJS.Timeout | null = null

// Workflow deletion tracking
export function addDeletedWorkflow(id: string): void {
  deletedWorkflowIds.add(id)
}

// Prepare workflow data
async function prepareSyncPayload(
  id: string,
  metadata: { name: string; description?: string }
): Promise<WorkflowSyncPayload | null> {
  const savedState = localStorage.getItem(`workflow-${id}`)
  if (!savedState) return null

  const state = JSON.parse(savedState)
  const mergedBlocks = mergeSubblockState(state.blocks, id)

  return {
    id,
    name: metadata.name,
    description: metadata.description,
    state: {
      blocks: mergedBlocks,
      edges: state.edges,
      loops: state.loops,
      lastSaved: state.lastSaved,
    },
  }
}

// Check if workflow has scheduling enabled
function hasSchedulingEnabled(state: WorkflowSyncPayload['state']): boolean {
  const starterBlock = Object.values(state.blocks).find((block) => block.type === 'starter')
  if (!starterBlock) return false

  const startWorkflow = starterBlock.subBlocks.startWorkflow?.value
  return startWorkflow === 'schedule'
}

// Server sync logic
async function syncWorkflowsToServer(payloads: WorkflowSyncPayload[]): Promise<boolean> {
  try {
    // First sync workflows to the database
    const response = await fetch(API_ENDPOINTS.SYNC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflows: payloads,
        deletedWorkflowIds: Array.from(deletedWorkflowIds),
      }),
      keepalive: true,
    })

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = API_ENDPOINTS.LOGIN
        return false
      }
      throw new Error(`Batch sync failed: ${response.statusText}`)
    }

    // Then update schedules for workflows that have scheduling enabled
    const scheduleResults = await Promise.allSettled(
      payloads.map(async (payload) => {
        // Update schedule if workflow has scheduling enabled
        if (hasSchedulingEnabled(payload.state)) {
          const response = await fetch(API_ENDPOINTS.SCHEDULE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId: payload.id,
              state: payload.state,
            }),
          })

          if (!response.ok) {
            throw new Error(
              `Failed to update schedule for workflow ${payload.id}: ${response.statusText}`
            )
          }

          const result = await response.json()
          console.log(`Schedule updated for workflow ${payload.id}:`, result)
        }
      })
    )

    // Log any schedule sync failures but don't fail the overall sync
    scheduleResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to sync schedule for workflow ${payloads[index].id}:`, result.reason)
      }
    })

    deletedWorkflowIds.clear()
    console.log('Workflows synced successfully')
    return true
  } catch (error) {
    console.error('Error syncing workflows:', error)
    return false
  }
}

// Periodic sync execution
export async function performSync(): Promise<void> {
  const { workflows } = useWorkflowRegistry.getState()

  const syncPayloads = await Promise.all(
    Object.entries(workflows).map(([id, metadata]) => prepareSyncPayload(id, metadata))
  )

  const validPayloads = syncPayloads.filter(
    (payload): payload is WorkflowSyncPayload => payload !== null
  )

  if (validPayloads.length > 0) {
    await syncWorkflowsToServer(validPayloads)
  }
}

// New function to fetch workflows from the server
export async function fetchWorkflowsFromServer(): Promise<boolean> {
  try {
    const response = await fetch(API_ENDPOINTS.FETCH, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = API_ENDPOINTS.LOGIN
        return false
      }
      console.error(`Failed to fetch workflows: ${response.statusText}`)
      return false
    }

    const data = await response.json()
    const { workflows } = data

    if (!workflows || !Array.isArray(workflows)) {
      console.warn('No workflows returned from server')
      return false
    }

    // Update workflow registry
    const registry: Record<string, any> = {}
    workflows.forEach((workflow: any) => {
      // Store workflow in registry
      registry[workflow.id] = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description || '',
        lastModified: new Date(workflow.updatedAt),
      }

      // Store workflow state in localStorage
      localStorage.setItem(
        `workflow-${workflow.id}`,
        JSON.stringify({
          blocks: workflow.state.blocks,
          edges: workflow.state.edges,
          loops: workflow.state.loops,
          history: {
            past: [],
            present: {
              state: {
                blocks: workflow.state.blocks,
                edges: workflow.state.edges,
                loops: workflow.state.loops,
              },
              timestamp: Date.now(),
              action: 'Loaded from server',
            },
            future: [],
          },
          lastSaved: Date.now(),
        })
      )

      // Initialize subblock values
      const subblockValues: Record<string, Record<string, any>> = {}
      Object.entries(workflow.state.blocks).forEach(([blockId, block]: [string, any]) => {
        subblockValues[blockId] = {}
        if (block.subBlocks) {
          Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
            if (subBlock && subBlock.value !== undefined) {
              subblockValues[blockId][subBlockId] = subBlock.value
            }
          })
        }
      })

      // Store subblock values in localStorage
      localStorage.setItem(`subblock-values-${workflow.id}`, JSON.stringify(subblockValues))
    })

    // Update registry in localStorage
    localStorage.setItem('workflow-registry', JSON.stringify(registry))

    // Update the registry store
    useWorkflowRegistry.setState({ workflows: registry })

    console.log('Workflows loaded from server successfully')
    return true
  } catch (error) {
    console.error('Error fetching workflows:', error)
    return false
  }
}

// Modify the initialization function to fetch from server first
export function initializeSyncManager(): (() => void) | undefined {
  if (typeof window === 'undefined') return

  // First try to load from server, then set up regular syncing
  fetchWorkflowsFromServer().then(() => {
    syncInterval = setInterval(performSync, SYNC_INTERVAL_MS)
  })

  const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
    const { workflows } = useWorkflowRegistry.getState()
    const syncPayloads = await Promise.all(
      Object.entries(workflows).map(([id, metadata]) => prepareSyncPayload(id, metadata))
    )

    const validPayloads = syncPayloads.filter(
      (payload): payload is WorkflowSyncPayload => payload !== null
    )

    if (validPayloads.length > 0) {
      event.preventDefault()
      event.returnValue = ''
      await syncWorkflowsToServer(validPayloads)
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)

  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    if (syncInterval) {
      clearInterval(syncInterval)
      syncInterval = null
    }
  }
}
