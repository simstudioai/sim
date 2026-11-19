import { db, workflowDeploymentVersion } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import {
  type DeployedWorkflowData,
  loadWorkflowDeploymentSnapshot,
  materializeDeploymentState,
} from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Reports whether the durable draft has diverged from the active deployment.
 *
 * Owns both loads deliberately. The two operands are only comparable once each
 * has been through its own projection: the draft picks up handle canonicalization
 * and the block migrations from `loadWorkflowFromNormalizedTables`, and the
 * version's frozen jsonb picks up the equivalents — plus the `errorEnabled`
 * backfill — from `materializeDeploymentState`. Accepting either operand from a
 * caller is what let this surface compare a raw jsonb blob against a normalized
 * draft, so that the server and the client answered the same question
 * differently for the same workflow.
 *
 * All reads share one REPEATABLE READ snapshot; the CPU-only diff runs after
 * commit so the connection is not held idle in transaction.
 */
export async function checkNeedsRedeployment(workflowId: string): Promise<boolean> {
  const snapshot = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    const deployedState = await loadActiveDeployedState(tx, workflowId)
    if (!deployedState) return null

    const currentState = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    if (!currentState) return null

    return { currentState, deployedState }
  })

  if (!snapshot) return false
  return differsFromDeployed(snapshot.currentState, snapshot.deployedState)
}

/**
 * Reports whether `draft`, a draft not written yet, would diverge from the active deployment: what
 * a dry run answers, since it stores nothing for {@link checkNeedsRedeployment} to load. `draft`
 * must be in the shape a write stores (`prepareWorkflowStateForPersistence`, with the variables
 * the write leaves), built from the stored draft as loaded, so the two compare as stored states do.
 */
export async function checkDraftNeedsRedeployment(
  workflowId: string,
  draft: WorkflowState
): Promise<boolean> {
  const deployedState = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    return loadActiveDeployedState(tx, workflowId)
  })
  return deployedState !== null && differsFromDeployed(draft, deployedState)
}

/** {@link hasWorkflowChanged} against a deployed state, whose variables are untyped JSON. */
function differsFromDeployed(draft: WorkflowState, deployed: DeployedWorkflowData): boolean {
  return hasWorkflowChanged(draft, deployed as WorkflowState)
}

/**
 * The active deployment's state, through the same projection the draft load applies; `null` when
 * the workflow has no usable active deployment.
 *
 * `workspaceId` is selected here, in the caller's transaction, rather than left for
 * `materializeDeploymentState` to look up: resolving an absent one goes through
 * `getActiveWorkflowContext`, which queries the global pool while this transaction holds a pooled
 * connection, which `packages/db/tx-tripwire.ts` refuses outside production.
 */
async function loadActiveDeployedState(
  tx: DbOrTx,
  workflowId: string
): Promise<DeployedWorkflowData | null> {
  const [active] = await tx
    .select({
      id: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
      workspaceId: workflowTable.workspaceId,
    })
    .from(workflowDeploymentVersion)
    .innerJoin(workflowTable, eq(workflowTable.id, workflowDeploymentVersion.workflowId))
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .orderBy(desc(workflowDeploymentVersion.createdAt))
    .limit(1)

  /* The inner join guarantees a workspace row; a null id means unusable data. */
  if (!active?.state || !active.workspaceId) return null
  return materializeDeploymentState(workflowId, active, active.workspaceId, tx)
}
