import type { useVariablesStore } from '@/stores/variables/store'
import type { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import type { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type {
  canApplyDraftSnapshot,
  captureDraftVersions,
  syncLocalDraftFromServer,
} from '@/stores/workflows/sync-local-draft'
import type { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** The real workflow stores, which only the Workflows tab loads. */
export interface WorkflowStateModules {
  registry: typeof useWorkflowRegistry
  workflow: typeof useWorkflowStore
  subBlock: typeof useSubBlockStore
  diff: typeof useWorkflowDiffStore
  variables: typeof useVariablesStore
  draft: {
    canApplyDraftSnapshot: typeof canApplyDraftSnapshot
    captureDraftVersions: typeof captureDraftVersions
    syncLocalDraftFromServer: typeof syncLocalDraftFromServer
  }
}

let connected: WorkflowStateModules | null = null
const listeners = new Set<() => void>()

/** Hands the bridges the real stores. The Workflows tab's providers call it as they load. */
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
 * The real stores, for code that only runs inside a workflow room. A room is joined only after the
 * Workflows tab has connected them, so reaching this earlier is a bug, not a state to tolerate.
 */
export function requireWorkflowState(): WorkflowStateModules {
  if (!connected) {
    throw new Error('Workflow state is used before the Workflows tab connected it')
  }
  return connected
}
