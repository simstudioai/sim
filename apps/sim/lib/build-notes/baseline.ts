import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { isRecordLike, sortObjectKeysDeep, toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { generateWorkflowDiffSummary, omitPresentationChanges } from '@/lib/workflows/comparison'
import {
  type PublicWorkflowDiffSummary,
  redactWorkflowDiffSummary,
} from '@/lib/workflows/comparison/redact'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/extractor'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * The same policy public version reads apply: credentials, passwords and opaque values are
 * cleared, while env-var references and workspace bindings stay so the diff stays meaningful.
 */
const BASELINE_SANITIZATION = {
  preserveEnvVars: true,
  preserveWorkspaceBindings: true,
  redactOpaqueCredentialInputs: true,
} as const

/** The graph a baseline holds: the stored workflow, sanitized, with no save clock. */
function sanitizedState(state: WorkflowState): WorkflowState {
  const sanitized = sanitizeWorkflowForSharing(state, BASELINE_SANITIZATION)
  return toWorkflowState({ ...sanitized, lastSaved: 0 })
}

function toWorkflowState(value: unknown): WorkflowState {
  if (!isRecordLike(value) || !isRecordLike(value.blocks) || !Array.isArray(value.edges)) {
    throw new OrchestrationError('internal', 'A build-notes baseline is not a workflow graph')
  }
  return {
    blocks: value.blocks as WorkflowState['blocks'],
    edges: value.edges as WorkflowState['edges'],
    loops: toRecord(value.loops) as WorkflowState['loops'],
    parallels: toRecord(value.parallels) as WorkflowState['parallels'],
    variables: toRecord(value.variables) as WorkflowState['variables'],
    lastSaved: 0,
  }
}

/** The workflow as it is stored now, sanitized, and the `updatedAt` it was read at. */
export async function loadCurrentBaselineState(
  workflowId: string,
  executor: DbOrTx = db
): Promise<{ state: WorkflowState; workflowUpdatedAt: Date }> {
  const [snapshot, [row]] = await Promise.all([
    loadWorkflowDeploymentSnapshot(workflowId, executor),
    executor
      .select({ updatedAt: workflow.updatedAt })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1),
  ])
  if (!snapshot || !row) throw new OrchestrationError('not_found', 'Workflow not found')
  return { state: sanitizedState(snapshot), workflowUpdatedAt: row.updatedAt }
}

export function serializeBaseline(state: WorkflowState): string {
  return `${JSON.stringify(sortObjectKeysDeep(state), null, 2)}\n`
}

export function parseBaseline(content: string): WorkflowState {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new OrchestrationError('internal', 'A build-notes baseline is not valid JSON')
  }
  return toWorkflowState(parsed)
}

/** What changed from the baseline to the current graph, ignoring layout-only moves. */
export function diffFromBaseline(
  baseline: WorkflowState,
  current: WorkflowState
): { hasChanges: boolean; diff: PublicWorkflowDiffSummary } {
  const summary = omitPresentationChanges(generateWorkflowDiffSummary(current, baseline))
  return {
    hasChanges: summary.hasChanges,
    diff: redactWorkflowDiffSummary(summary, baseline, current),
  }
}
