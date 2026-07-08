import { db, runOutsideTransactionContext } from '@sim/db'
import { workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkspaceForkDeployBridge')

/**
 * Hard ceiling on how many deployed workflows one fork/promote loads into memory at
 * once (each as a full `WorkflowState`). There is no per-workspace workflow cap in
 * the product, so this is the safety valve: real workspaces hold tens to low
 * hundreds, making this ~5-10x headroom that never blocks legitimate use, it sits
 * below the fork feature's other item caps (resource selection 2000, mapping
 * entries 5000 - both lighter-weight than full states), and it bounds a pathological
 * workspace to a few hundred MB of transient state instead of an unbounded load.
 */
export const MAX_FORK_DEPLOYED_WORKFLOWS = 1000

export interface DeployedWorkflowSummary {
  id: string
  name: string
  description: string | null
  folderId: string | null
  sortOrder: number
  /** Whether the deployed API accepts unauthenticated calls; carried onto sync targets. */
  isPublicApi: boolean
}

/**
 * Workflows in a workspace that are deployed and not archived - the only ones that
 * fork/promote. Requires an actually-active deployment version, not just the
 * `isDeployed` flag: a workflow flagged deployed with no active version (a "ghost"
 * left by an inconsistent state) has nothing to copy, so excluding it here keeps the
 * diff/plan counts aligned with what apply actually writes instead of over-reporting
 * then silently skipping it. Correlated `exists` (not a join) so a workflow is never
 * double-listed if more than one active version row ever exists.
 */
export async function listDeployedWorkflows(
  executor: DbOrTx,
  workspaceId: string
): Promise<DeployedWorkflowSummary[]> {
  return executor
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      folderId: workflow.folderId,
      sortOrder: workflow.sortOrder,
      isPublicApi: workflow.isPublicApi,
    })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(workflowDeploymentVersion)
            .where(
              and(
                eq(workflowDeploymentVersion.workflowId, workflow.id),
                eq(workflowDeploymentVersion.isActive, true)
              )
            )
        )
      )
    )
}

/** The active deployment version number for a workflow, or null when it has none. */
export async function getActiveDeploymentVersionNumber(
  executor: DbOrTx,
  workflowId: string
): Promise<number | null> {
  const [row] = await executor
    .select({ version: workflowDeploymentVersion.version })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  return row?.version ?? null
}

/**
 * Batched {@link getActiveDeploymentVersionNumber}: the active deployed version per
 * workflow id, so promote's apply phase resolves every prior version in one query
 * instead of N round-trips inside the (locked) transaction. Workflows with no active
 * version are absent from the map.
 */
export async function getActiveDeploymentVersionNumbers(
  executor: DbOrTx,
  workflowIds: string[]
): Promise<Map<string, number>> {
  if (workflowIds.length === 0) return new Map()
  const rows = await executor
    .select({
      workflowId: workflowDeploymentVersion.workflowId,
      version: workflowDeploymentVersion.version,
    })
    .from(workflowDeploymentVersion)
    .where(
      and(
        inArray(workflowDeploymentVersion.workflowId, workflowIds),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
  return new Map(rows.map((row) => [row.workflowId, row.version]))
}

/**
 * Read a source workspace's deployed workflows and each one's active deployed state
 * on the global pool. Fork/promote callers MUST run this BEFORE opening their
 * transaction: doing these heavy per-workflow reads inside the tx checks out a
 * SECOND pooled connection while the tx holds the first, which can deadlock the
 * pool at saturation (primary pool max is 15). The source is read-only for the
 * operation, so a pre-transaction snapshot is the value that gets force-pushed.
 *
 * Holds every source state in memory at once (bounded by the workspace's deployed
 * workflow count) - the apply step needs each state to write its target inside the
 * single atomic transaction, so it cannot stream them one at a time.
 */
export async function loadSourceDeployedStates(sourceWorkspaceId: string): Promise<{
  deployedWorkflows: DeployedWorkflowSummary[]
  sourceStates: Map<string, WorkflowState>
}> {
  const deployedWorkflows = await listDeployedWorkflows(db, sourceWorkspaceId)
  // Fail fast on the cheap count before loading any heavy state into memory.
  if (deployedWorkflows.length > MAX_FORK_DEPLOYED_WORKFLOWS) {
    throw new ForkError(
      `This workspace has ${deployedWorkflows.length} deployed workflows, which exceeds the fork/sync limit of ${MAX_FORK_DEPLOYED_WORKFLOWS}.`,
      400
    )
  }
  // Read states in bounded-concurrency batches instead of one serial await per workflow:
  // serial cost is O(workflows) round trips (this also runs on the diff preview, refetched
  // while the sync modal is open). The cap keeps concurrent global-pool checkouts well
  // under the pool max even at the workflow ceiling, and this runs BEFORE any transaction.
  const sourceStates = new Map<string, WorkflowState>()
  const READ_CONCURRENCY = 5
  for (let i = 0; i < deployedWorkflows.length; i += READ_CONCURRENCY) {
    const batch = deployedWorkflows.slice(i, i + READ_CONCURRENCY)
    const states = await Promise.all(batch.map((wf) => readDeployedState(wf.id, sourceWorkspaceId)))
    batch.forEach((wf, index) => {
      const state = states[index]
      if (state) sourceStates.set(wf.id, state)
    })
  }
  return { deployedWorkflows, sourceStates }
}

/**
 * Read a workflow's active deployed state as a `WorkflowState`. Returns null ONLY
 * when the workflow genuinely has no active deployment (a legitimate skip); real
 * DB/migration errors propagate so the caller fails loudly instead of silently
 * dropping the workflow from the fork/promote. Block migrations (credential remap
 * to current ids) are applied so copied references reflect current resources.
 */
export async function readDeployedState(
  workflowId: string,
  workspaceId: string
): Promise<WorkflowState | null> {
  // This reads the (unchanged) SOURCE workspace on the global pool. Callers like
  // promote run it inside their transaction, so escape the tx context: the read
  // must not join the promote's transaction (and the tripwire forbids global-pool
  // queries inside a tx). Outside a transaction this is a no-op.
  return runOutsideTransactionContext(async () => {
    const version = await getActiveDeploymentVersionNumber(db, workflowId)
    if (version == null) {
      logger.warn('No active deployment for workflow during fork/promote', { workflowId })
      return null
    }
    const data = await loadDeployedWorkflowState(workflowId, workspaceId)
    return {
      blocks: data.blocks,
      edges: data.edges,
      loops: data.loops,
      parallels: data.parallels,
      variables: (data.variables ?? {}) as Record<string, Variable>,
    }
  })
}
