import { useWorkflowRegistry } from './workflow/registry/store'
import { mergeSubblockState } from './workflow/utils'

interface WorkflowSyncPayload {
  id: string
  name: string
  description?: string | undefined
  state: string
}

// Track deleted workflow IDs until they're synced
const deletedWorkflowIds = new Set<string>()

export function addDeletedWorkflow(id: string) {
  deletedWorkflowIds.add(id)
}

async function syncWorkflowsToServer(payloads: WorkflowSyncPayload[]): Promise<boolean> {
  try {
    const response = await fetch('/api/db/sync', {
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
        window.location.href = '/login'
        return false
      }
      throw new Error(`Batch sync failed: ${response.statusText}`)
    }

    // Clear the deleted IDs set after successful sync
    deletedWorkflowIds.clear()
    console.log('Workflows synced successfully')
    return true
  } catch (error) {
    console.error('Error syncing workflows:', error)
    return false
  }
}

let syncInterval: NodeJS.Timeout | null = null

async function performSync() {
  const { workflows } = useWorkflowRegistry.getState()

  // Prepare sync payloads for all workflows
  const syncPayloads: (WorkflowSyncPayload | null)[] = await Promise.all(
    Object.entries(workflows).map(async ([id, metadata]) => {
      const savedState = localStorage.getItem(`workflow-${id}`)
      if (!savedState) return null

      const state = JSON.parse(savedState)
      const mergedBlocks = mergeSubblockState(state.blocks)

      return {
        id,
        name: metadata.name,
        description: metadata.description,
        state: JSON.stringify({
          blocks: mergedBlocks,
          edges: state.edges,
          loops: state.loops,
          lastSaved: state.lastSaved,
        }),
      }
    })
  )

  // Filter out null values and sync if there are workflows to sync
  const validPayloads = syncPayloads.filter(
    (payload): payload is WorkflowSyncPayload => payload !== null
  )

  if (validPayloads.length > 0) {
    await syncWorkflowsToServer(validPayloads)
  }
}

export function initializeSyncManager() {
  if (typeof window === 'undefined') return

  // Start periodic sync
  syncInterval = setInterval(performSync, 30000) // Sync every 30 seconds

  const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
    // Perform one final sync before unloading
    event.preventDefault()
    event.returnValue = ''
    await performSync()
  }

  window.addEventListener('beforeunload', handleBeforeUnload)

  // Return cleanup function
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    if (syncInterval) {
      clearInterval(syncInterval)
      syncInterval = null
    }
  }
}
