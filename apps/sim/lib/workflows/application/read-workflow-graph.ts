import type { Principal } from '@sim/auth/principal'
import type { BlockState, Variable, WorkflowState } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'
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
  resolveContext: ({ principal, input }: { principal: Principal; input: ReadWorkflowGraphInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
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
  /** Normalize all persisted variable formats identically for graph reads and diagnostics. */
  const variables = parseWorkflowVariables(snapshot.workflowRecord.variables)
  return {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    blocks: (snapshot.normalizedData?.blocks ?? {}) as Record<string, BlockState>,
    edges: (snapshot.normalizedData?.edges ?? []) as WorkflowState['edges'],
    loops: snapshot.normalizedData?.loops ?? {},
    parallels: snapshot.normalizedData?.parallels ?? {},
    variables: variables ?? {},
  }
}
