import { useWorkflowRegistry } from './workflow/registry/store'
import { useWorkflowStore } from './workflow/store'

interface SyncPayload {
  id: string
  name: string
  description?: string
  state: string
}

async function syncWorkflowToServer(payload: SyncPayload): Promise<boolean> {
  try {
    const response = await fetch('/api/workflows/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true, // Ensures request completes even during page unload
    })

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login'
        return false
      }
      throw new Error(`Sync failed: ${response.statusText}`)
    }

    console.log('Workflow synced successfully')
    return true
  } catch (error) {
    console.error('Error syncing workflow:', error)
    return false
  }
}

export function initializeSyncManager() {
  if (typeof window === 'undefined') return

  const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
    const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
    const workflowState = useWorkflowStore.getState()

    if (!activeWorkflowId || !workflows[activeWorkflowId]) {
      return
    }

    const activeWorkflow = workflows[activeWorkflowId]
    const payload: SyncPayload = {
      id: activeWorkflowId,
      name: activeWorkflow.name,
      description: activeWorkflow.description,
      state: JSON.stringify({
        blocks: workflowState.blocks,
        edges: workflowState.edges,
        loops: workflowState.loops,
        lastSaved: workflowState.lastSaved,
      }),
    }

    // Show confirmation dialog
    event.preventDefault()
    event.returnValue = ''

    // Attempt to sync
    await syncWorkflowToServer(payload)
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}
