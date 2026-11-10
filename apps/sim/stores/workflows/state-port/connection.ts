import type { useVariablesStore } from '@/stores/variables/store'
import type { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type {
  canApplyDraftSnapshot,
  captureDraftVersions,
  syncLocalDraftFromServer,
} from '@/stores/workflows/sync-local-draft'
import type { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** The real workflow stores, which pull in every block and trigger. */
interface WorkflowStateModules {
  registry: typeof useWorkflowRegistry
  workflow: typeof useWorkflowStore
  subBlock: typeof useSubBlockStore
  variables: typeof useVariablesStore
  draft: {
    canApplyDraftSnapshot: typeof canApplyDraftSnapshot
    captureDraftVersions: typeof captureDraftVersions
    syncLocalDraftFromServer: typeof syncLocalDraftFromServer
  }
}

let connected: WorkflowStateModules | null = null
const listeners = new Set<() => void>()

/** Hands the port the real stores; `connect-stores.ts` is its one caller. */
export function connectWorkflowState(modules: WorkflowStateModules) {
  if (connected) return
  connected = modules
  for (const listener of listeners) listener()
}

export function connectedWorkflowState(): WorkflowStateModules | null {
  return connected
}

export function onWorkflowStateConnected(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The real stores, for code that only runs inside a workflow room. A room is joined only where the
 * real stores are connected, so reaching this earlier is a bug, not a state to tolerate.
 */
export function requireWorkflowState(): WorkflowStateModules {
  if (!connected) {
    throw new Error('Workflow state is used before the workflow stores were connected')
  }
  return connected
}
