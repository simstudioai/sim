import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { connectWorkflowState } from '@/stores/workflows/state-port/connection'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  canApplyDraftSnapshot,
  captureDraftVersions,
  syncLocalDraftFromServer,
} from '@/stores/workflows/sync-local-draft'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Points the workflow state port at the real stores, which load every block and trigger. Called at
 * module scope by each surface that hosts the workflow editor or a workflow-driving chat, before
 * anything renders. Kept out of the port's barrel so importing the port never loads these stores.
 */
export function connectWorkflowStores() {
  connectWorkflowState({
    registry: useWorkflowRegistry,
    workflow: useWorkflowStore,
    subBlock: useSubBlockStore,
    diff: useWorkflowDiffStore,
    variables: useVariablesStore,
    draft: { canApplyDraftSnapshot, captureDraftVersions, syncLocalDraftFromServer },
  })
}
