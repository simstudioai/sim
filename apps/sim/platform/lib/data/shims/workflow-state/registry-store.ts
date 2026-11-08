import { useSyncExternalStore } from 'react'
import {
  connectedWorkflowState,
  onWorkflowStateConnected,
} from '@/platform/lib/data/shims/workflow-state/connection'
import type { WorkflowRegistry } from '@/stores/workflows/registry/types'

type RegistryView = Pick<WorkflowRegistry, 'activeWorkflowId' | 'hydration' | 'setActiveWorkflow'>

/** Before the Workflows tab loads, a chat run tool still names the workflow it targets here. */
const IDLE: RegistryView = {
  activeWorkflowId: null,
  hydration: { phase: 'idle', workspaceId: null, workflowId: null, requestId: null, error: null },
  setActiveWorkflow: async (workflowId) => {
    IDLE.activeWorkflowId = workflowId
  },
}

function readRegistry(): RegistryView {
  return connectedWorkflowState()?.registry.getState() ?? IDLE
}

function subscribe(notify: () => void) {
  let unsubscribeStore = connectedWorkflowState()?.registry.subscribe(notify)
  const unsubscribeConnection = onWorkflowStateConnected(() => {
    unsubscribeStore?.()
    unsubscribeStore = connectedWorkflowState()?.registry.subscribe(notify)
    notify()
  })
  return () => {
    unsubscribeConnection()
    unsubscribeStore?.()
  }
}

/**
 * Stands in for `stores/workflows/registry/store` where the shared socket provider and the chat hook
 * and its run tool import it. The real store pulls in every block and trigger, and one of those two is on every
 * Platform page. This reads an idle registry until the Workflows tab connects the real one, then
 * follows it, so a room is never joined outside that tab. Only the fields those importers read exist.
 */
export function useWorkflowRegistry<T>(selector: (state: RegistryView) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(readRegistry()),
    () => selector(IDLE)
  )
}

useWorkflowRegistry.getState = readRegistry
