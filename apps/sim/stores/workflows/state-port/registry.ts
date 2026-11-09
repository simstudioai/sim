import { useSyncExternalStore } from 'react'
import type { WorkflowRegistry } from '@/stores/workflows/registry/types'
import {
  connectedWorkflowState,
  onWorkflowStateConnected,
} from '@/stores/workflows/state-port/connection'

type RegistryView = Pick<WorkflowRegistry, 'activeWorkflowId' | 'hydration' | 'setActiveWorkflow'>

/** Before the real stores connect, a chat run tool still names the workflow it targets here. */
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
 * The workflow registry as the shared socket provider, the chat hook, its run tool and the execution
 * store read it. The real store pulls in every block and trigger, and one of those modules is on
 * every page, so they read this port instead: an idle registry until `connectWorkflowStores` hands
 * it the real one, then the real one. Only the fields those importers read exist.
 */
export function useWorkflowRegistry<T>(selector: (state: RegistryView) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(readRegistry()),
    () => selector(IDLE)
  )
}

useWorkflowRegistry.getState = readRegistry
