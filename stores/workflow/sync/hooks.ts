import { useCallback, useEffect, useRef } from 'react'
import debounce from 'lodash.debounce'
import { useWorkflowRegistry } from '../registry/store'
import { useWorkflowStore } from '../store'

const SYNC_DEBOUNCE_MS = 2000 // 2 seconds
const PERIODIC_SYNC_MS = 30000 // 30 seconds

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
    })

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`)
    }

    return true
  } catch (error) {
    console.error('Error syncing workflow:', error)
    return false
  }
}

export function useDebouncedWorkflowSync() {
  const workflowState = useWorkflowStore((state) => ({
    blocks: state.blocks,
    edges: state.edges,
    loops: state.loops,
    lastSaved: state.lastSaved,
  }))
  const { activeWorkflowId, workflows } = useWorkflowRegistry()

  const debouncedSyncRef = useRef<ReturnType<typeof debounce> | null>(null)

  useEffect(() => {
    if (!activeWorkflowId || !workflows[activeWorkflowId]) return

    const syncWorkflow = async () => {
      const activeWorkflow = workflows[activeWorkflowId]
      const payload: SyncPayload = {
        id: activeWorkflowId,
        name: activeWorkflow.name,
        description: activeWorkflow.description,
        state: JSON.stringify(workflowState),
      }

      await syncWorkflowToServer(payload)
    }

    // Create a debounced version of syncWorkflow
    if (!debouncedSyncRef.current) {
      debouncedSyncRef.current = debounce(syncWorkflow, SYNC_DEBOUNCE_MS)
    }

    // Call the debounced sync
    debouncedSyncRef.current()

    // Cleanup
    return () => {
      debouncedSyncRef.current?.cancel()
    }
  }, [activeWorkflowId, workflows, workflowState])
}

export function usePeriodicWorkflowSync() {
  const workflowState = useWorkflowStore((state) => ({
    blocks: state.blocks,
    edges: state.edges,
    loops: state.loops,
    lastSaved: state.lastSaved,
  }))
  const { activeWorkflowId, workflows } = useWorkflowRegistry()

  useEffect(() => {
    if (!activeWorkflowId || !workflows[activeWorkflowId]) return

    const syncWorkflow = async () => {
      const activeWorkflow = workflows[activeWorkflowId]
      const payload: SyncPayload = {
        id: activeWorkflowId,
        name: activeWorkflow.name,
        description: activeWorkflow.description,
        state: JSON.stringify(workflowState),
      }

      await syncWorkflowToServer(payload)
    }

    const intervalId = setInterval(syncWorkflow, PERIODIC_SYNC_MS)

    return () => clearInterval(intervalId)
  }, [activeWorkflowId, workflows, workflowState])
}

export function useSyncOnUnload() {
  const workflowState = useWorkflowStore((state) => ({
    blocks: state.blocks,
    edges: state.edges,
    loops: state.loops,
    lastSaved: state.lastSaved,
  }))
  const { activeWorkflowId, workflows } = useWorkflowRegistry()

  useEffect(() => {
    if (!activeWorkflowId || !workflows[activeWorkflowId]) return

    const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
      const activeWorkflow = workflows[activeWorkflowId]
      const payload: SyncPayload = {
        id: activeWorkflowId,
        name: activeWorkflow.name,
        description: activeWorkflow.description,
        state: JSON.stringify(workflowState),
      }

      // Use the keepalive option to try to complete the request even during unload
      await fetch('/api/workflows/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })

      // Show a confirmation dialog
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeWorkflowId, workflows, workflowState])
}
