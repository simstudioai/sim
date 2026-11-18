import type { NormalizedWorkflowData } from '@sim/workflow-persistence/types'
import type { BlockState, Variable, WorkflowState } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowReadSnapshot, loadWorkflowReadSnapshots } from '@/lib/workflows/queries'
import {
  type CopilotWorkflowState,
  sanitizeForCopilot,
} from '@/lib/workflows/sanitization/json-sanitizer'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'

export interface ReadWorkflowGraphInput {
  workflowId: string
  assertedWorkspaceId?: string
}

export interface ReadWorkflowGraphResult {
  workflowId: string
  workspaceId: string
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  loops: WorkflowState['loops']
  parallels: WorkflowState['parallels']
  variables: Record<string, Variable>
}

/**
 * Reads a workflow's editable draft graph, unsanitized.
 *
 * The same semantic operation as `readWorkflow` — "read this workflow" — and the
 * same loader, so the two reads cannot disagree about migrate-on-read.
 *
 * Records **no** semantic audit, deliberately. This is the pollable read; the
 * audited, portable, sanitized one is `workflows.export`, and auditing here
 * would force `headSafe: false` and make the endpoint unusable for polling.
 *
 * Existence is decided by the workflow row alone, never by the block rows.
 * `loadWorkflowFromNormalizedTables` answers `null` for a workflow with zero
 * blocks, and a blockless draft is a legitimate state a client can reach — a
 * `PUT /state` of `{ blocks: {}, edges: [] }` writes exactly that. Reading it
 * back as `not_found` would break the read-modify-write round trip the graph
 * schema promises, so the null is projected as an empty graph instead.
 */
export const readWorkflowGraph = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: resolvePrincipalWorkflowContext<ReadWorkflowGraphInput>,
  async execute({ context }): Promise<ReadWorkflowGraphResult> {
    return loadWorkflowGraph(context)
  },
})

/** Loads the canonical draft after the application operation has authorized its context. */
export async function loadWorkflowGraph(context: {
  workflowId: string
  workspaceId: string
}): Promise<ReadWorkflowGraphResult> {
  const snapshot = await loadWorkflowReadSnapshot(context.workflowId, context.workspaceId)
  if (!snapshot.workflowRecord) {
    throw new OrchestrationError('not_found', 'Workflow not found')
  }
  return graphOf(context, snapshot.normalizedData, snapshot.workflowRecord.variables)
}

/**
 * {@link loadWorkflowGraph} for many workflows of one workspace, read in one snapshot, each with
 * its row's name and description, by workflow id. A workflow that is archived or not in the
 * workspace is left out.
 */
export async function loadWorkflowGraphs(
  workspaceId: string,
  workflowIds: readonly string[]
): Promise<
  Map<string, { graph: ReadWorkflowGraphResult; name: string; description: string | null }>
> {
  const snapshots = await loadWorkflowReadSnapshots(workflowIds, workspaceId)
  return new Map(
    [...snapshots].map(([workflowId, { normalizedData, workflowRecord }]) => [
      workflowId,
      {
        graph: graphOf({ workflowId, workspaceId }, normalizedData, workflowRecord.variables),
        name: workflowRecord.name,
        description: workflowRecord.description,
      },
    ])
  )
}

/** A loaded draft as the graph read returns it, every persisted variable format normalized. */
function graphOf(
  context: { workflowId: string; workspaceId: string },
  normalizedData: NormalizedWorkflowData | null,
  storedVariables: Parameters<typeof parseWorkflowVariables>[0]
): ReadWorkflowGraphResult {
  return {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    blocks: (normalizedData?.blocks ?? {}) as Record<string, BlockState>,
    edges: (normalizedData?.edges ?? []) as WorkflowState['edges'],
    loops: normalizedData?.loops ?? {},
    parallels: normalizedData?.parallels ?? {},
    variables: parseWorkflowVariables(storedVariables) ?? {},
  }
}

/**
 * Reads a workflow's draft as a compact read-only outline, under the same
 * authorization and loader as {@link readWorkflowGraph}. It carries derived
 * fields graph writes reject, so it is never a write body.
 */
export const readWorkflowOutline = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: resolvePrincipalWorkflowContext<ReadWorkflowGraphInput>,
  async execute({ context }): Promise<CopilotWorkflowState> {
    const { blocks, edges, loops, parallels } = await loadWorkflowGraph(context)
    return sanitizeForCopilot({ blocks, edges, loops, parallels })
  },
})
