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

// Sync manager initialization
export function initializeSyncManager(): (() => void) | undefined {
  if (typeof window === 'undefined') return

  syncInterval = setInterval(performSync, SYNC_INTERVAL_MS)

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
