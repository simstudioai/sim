import { createStore, useStore } from 'zustand'
import type { WorkflowRegistry } from '@/stores/workflows/registry/types'
import {
  connectedWorkflowState,
  onWorkflowStateConnected,
} from '@/stores/workflows/state-port/connection'

type RegistryView = Pick<WorkflowRegistry, 'activeWorkflowId' | 'hydration' | 'setActiveWorkflow'>

/**
 * Mirrors the real registry once `connectWorkflowStores` hands it over. Until then it is idle, and a
 * chat run tool still names the workflow it targets here.
 */
const relay = createStore<RegistryView>()((set) => ({
  activeWorkflowId: null,
  hydration: { phase: 'idle', workspaceId: null, workflowId: null, requestId: null, error: null },
  setActiveWorkflow: async (workflowId) => set({ activeWorkflowId: workflowId }),
}))

function followConnectedRegistry() {
  const registry = connectedWorkflowState()?.registry
  if (!registry) return
  relay.setState(registry.getState(), true)
  registry.subscribe((state) => relay.setState(state, true))
}

followConnectedRegistry()
onWorkflowStateConnected(followConnectedRegistry)

/**
 * The workflow registry as the shared socket provider, the chat hook, its run tool and the execution
 * store read it. The real store pulls in every block and trigger, and one of those modules is on
 * every page, so they read this port instead: an idle registry until the real one connects, then a
 * mirror of it. Only the fields those importers read exist.
 */
export function useWorkflowRegistry<T>(selector: (state: RegistryView) => T): T {
  return useStore(relay, selector)
}

useWorkflowRegistry.getState = relay.getState
