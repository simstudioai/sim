import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import debounce from 'lodash.debounce'
import { useNotificationStore } from '@/stores/notifications/store'
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
      if (response.status === 401) {
        // Auth error - will be handled by the middleware
        window.location.href = '/login'
        return false
      }
      throw new Error(`Sync failed: ${response.statusText}`)
    }

    return true
  } catch (error) {
    console.error('Error syncing workflow:', error)
    return false
  }
}

export function useDebouncedWorkflowSync() {
  const router = useRouter()
  const { addNotification } = useNotificationStore()
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

      const success = await syncWorkflowToServer(payload)
      if (!success) {
        addNotification(
          'error',
          'Failed to save workflow changes. Please try again.',
          activeWorkflowId
        )
      }
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
  }, [activeWorkflowId, workflows, workflowState, addNotification])
}

export function usePeriodicWorkflowSync() {
  const { addNotification } = useNotificationStore()
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

      const success = await syncWorkflowToServer(payload)
      if (!success) {
        addNotification(
          'error',
          'Failed to auto-save workflow changes. Please save manually.',
          activeWorkflowId
        )
      }
    }

    const intervalId = setInterval(syncWorkflow, PERIODIC_SYNC_MS)

    return () => clearInterval(intervalId)
  }, [activeWorkflowId, workflows, workflowState, addNotification])
}

export function useSyncOnUnload() {
  const { addNotification } = useNotificationStore()
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
      const response = await fetch('/api/workflows/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })

      if (!response.ok) {
        addNotification(
          'error',
          'Failed to save workflow changes before closing.',
          activeWorkflowId
        )
      }

      // Show a confirmation dialog
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeWorkflowId, workflows, workflowState, addNotification])
}
