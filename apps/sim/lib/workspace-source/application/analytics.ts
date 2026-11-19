import type { Principal } from '@sim/auth/principal'
import { captureServerEvent } from '@/lib/posthog/server'
import { sourceActor } from '@/lib/workflows/application/source-analytics'
import type { ChangeAction } from '@/lib/workspace-source/application/types'

interface WorkspaceApplyFacts {
  principal: Principal
  client: string | undefined
  workspaceId: string
}

/** A planned or written change, as far as analytics reads it. */
interface ChangeFact {
  kind: string
  action: ChangeAction
}

/**
 * How an apply settled: refused with nothing written (`rejected` for error findings, `busy` for
 * another apply holding the workspace), or the changes written and the failure that stopped it.
 */
type WorkspaceApplyOutcome =
  | { refused: 'rejected' | 'busy' }
  | { applied: readonly ChangeFact[]; failed?: { code: string } }

/**
 * A settled workspace source apply: `workspace_source_applied`, attributed like a workflow source
 * write. It carries kinds and counts only, never keys, names or file contents.
 */
export function recordWorkspaceSourceApplied(
  facts: WorkspaceApplyFacts,
  planned: readonly ChangeFact[],
  outcome: WorkspaceApplyOutcome
): void {
  const actor = sourceActor(facts.principal, facts.client)
  if (!actor) return
  const kinds = [
    ...new Set(planned.filter((change) => change.action !== 'noop').map(({ kind }) => kind)),
  ]
  const written = 'applied' in outcome ? outcome.applied : []
  const count = (...actions: ChangeAction[]) =>
    written.filter((change) => actions.includes(change.action)).length
  const errorKind = 'refused' in outcome ? outcome.refused : outcome.failed?.code
  captureServerEvent(
    actor.userId,
    'workspace_source_applied',
    {
      workspace_id: facts.workspaceId,
      source: actor.source,
      outcome: 'refused' in outcome ? 'refused' : outcome.failed ? 'partial' : 'committed',
      kinds,
      created: count('create'),
      updated: count('update', 'adopt'),
      deleted: count('delete'),
      ...(errorKind ? { error_kind: errorKind } : {}),
    },
    { groups: { workspace: facts.workspaceId } }
  )
}
