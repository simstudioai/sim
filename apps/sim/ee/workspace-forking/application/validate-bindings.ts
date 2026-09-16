import type { Principal } from '@sim/auth/principal'
import type { DbOrTx } from '@/lib/db/types'
import {
  authorizeWorkflowBindingCredentials,
  validateWorkflowBindingTargets,
} from '@/lib/workflows/references/binding-targets'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import type { ForkReferenceResolver } from '@/lib/workflows/references/remap-references'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Validates the destination bindings used by both persisted and request-local mapping entries. */
export async function validateForkWorkflowBindings(params: {
  executor: DbOrTx
  workspaceId: string
  sourceStates: Map<string, WorkflowState>
  items: Array<{ sourceWorkflowId: string }>
  resolve: ForkReferenceResolver
  principal?: Principal
  lock?: boolean
}): Promise<void> {
  for (const item of params.items) {
    const state = params.sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    const manifest = buildWorkflowReferenceManifest(state.blocks)
    const bindings = manifest.references.flatMap((reference) => {
      if (reference.kind === 'workflow') return []
      const targetId = params.resolve(reference.kind, reference.sourceId)
      return targetId
        ? reference.occurrences.map((occurrence) => ({
            kind: reference.kind,
            sourceId: reference.sourceId,
            targetId,
            required: reference.required,
            occurrence,
          }))
        : []
    })
    const plan = { state, sourceState: state, manifest, bindings, unresolvedBindings: [] }
    if (params.principal)
      await authorizeWorkflowBindingCredentials(params.principal, params.workspaceId, plan)
    await validateWorkflowBindingTargets(params.executor, params.workspaceId, plan, {
      lock: params.lock,
    })
  }
}
