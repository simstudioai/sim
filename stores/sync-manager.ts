import { useWorkflowRegistry } from './workflow/registry/store'
import { useWorkflowStore } from './workflow/store'
import { mergeSubblockState } from './workflow/utils'

interface WorkflowSyncPayload {
  id: string
  name: string
  description?: string | undefined
  state: string
}

async function syncWorkflowsToServer(payloads: WorkflowSyncPayload[]): Promise<boolean> {
  try {
    const response = await fetch('/api/db/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: payloads }),
      keepalive: true,
    })

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login'
        return false
      }
      throw new Error(`Batch sync failed: ${response.statusText}`)
    }

    console.log('Workflows synced successfully')
    return true
  } catch (error) {
    console.error('Error syncing workflows:', error)
    return false
  }
}

export function initializeSyncManager() {
  if (typeof window === 'undefined') return

  const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
    const { workflows } = useWorkflowRegistry.getState()

    // Prepare sync payloads for all workflows
    const syncPayloads: (WorkflowSyncPayload | null)[] = await Promise.all(
      Object.entries(workflows).map(async ([id, metadata]) => {
        // Get workflow state from localStorage
        const savedState = localStorage.getItem(`workflow-${id}`)
        if (!savedState) return null

        const state = JSON.parse(savedState)
        // Merge subblock states for all blocks in the workflow
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
      // Show confirmation dialog
      event.preventDefault()
      event.returnValue = ''

      // Attempt to sync
      await syncWorkflowsToServer(validPayloads)
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}
