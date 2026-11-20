import type { Diagnostic } from '@sim/workflow-code'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import type { ResolvedSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/resolve'
import type { SourceEvaluationInput } from '@/lib/workflows/application/source-pipeline/evaluate/types'
import { gateSourceDiff } from '@/lib/workflows/code/apply/gates'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findLiveTriggerRemovals } from '@/lib/workflows/code/apply/live-triggers'
import { findLockedBlockRefusals } from '@/lib/workflows/code/apply/locked'
import { findInvalidSchedules } from '@/lib/workflows/code/apply/schedules'

/** The gates phase's result: the graph diff and every gate's findings. */
export interface GatedGraph {
  /** The stored graph. */
  storedGraph: SourceGraph
  graphDiff: ReturnType<typeof diffGraphs>
  /** The materialized blocks, with every hosted key a gate drops cleared. */
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  /** Locked blocks, invalid schedules, engine gates and live triggers removed, in that order. */
  gateFindings: Diagnostic[]
}

/**
 * Diffs the materialized graph against the stored one and runs every gate on the diff: locked
 * blocks, schedules, the engine gates (block types, permission groups, hosted keys) and live
 * triggers a removal or retype would drop. A hosted key a gate drops is cleared from its block.
 */
export async function gateSourceGraph(
  input: SourceEvaluationInput,
  resolved: ResolvedSubmission
): Promise<GatedGraph> {
  const { principal, scope, catalog } = input
  const { state } = input.stored
  const { materialized, keyOf, permissionConfig } = resolved

  const storedGraph: SourceGraph = { blocks: state.blocks, edges: state.edges }
  let blocks = materialized.state.blocks
  const edges = materialized.state.edges
  const graphDiff = diffGraphs(storedGraph, { blocks, edges })

  const typeChanged = graphDiff.modified.filter((change) => change.typeChanged).map((c) => c.id)
  const [gateDiagnostics, liveTriggerRefusals] = await Promise.all([
    gateSourceDiff({
      base: storedGraph,
      target: { blocks, edges },
      diff: graphDiff,
      catalog,
      keyOf,
      permissionConfig,
      subjectUserId: scope.subjectUserId,
      workspaceId: scope.workspaceId,
      isCopilot: principal.kind === 'delegated' && principal.serviceId === 'copilot',
    }),
    findLiveTriggerRemovals(
      scope.workflowId,
      [...graphDiff.removed, ...typeChanged].map((id) => state.blocks[id]),
      keyOf
    ),
  ])
  const gateFindings: Diagnostic[] = [
    ...findLockedBlockRefusals(storedGraph, { blocks, edges }, graphDiff, keyOf),
    ...findInvalidSchedules({ blocks, edges }, graphDiff, keyOf),
    ...gateDiagnostics,
    ...liveTriggerRefusals,
  ]

  for (const diagnostic of gateDiagnostics) {
    if (diagnostic.code !== 'W_APPLY_HOSTED_KEY_DROPPED' || !diagnostic.blockId) continue
    const { blockId, param } = diagnostic
    const block = blocks[blockId]
    if (!param || !block?.subBlocks?.[param]) continue
    blocks = {
      ...blocks,
      [blockId]: {
        ...block,
        subBlocks: { ...block.subBlocks, [param]: { ...block.subBlocks[param], value: null } },
      },
    }
  }

  return { storedGraph, graphDiff, blocks, edges, gateFindings }
}
