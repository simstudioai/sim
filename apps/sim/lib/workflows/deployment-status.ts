import { db, workflowDeploymentVersion } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import {
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
 */
export async function checkNeedsRedeployment(workflowId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    /*
     * `workspaceId` is selected here, in this transaction, rather than left for
     * `materializeDeploymentState` to look up: resolving an absent one goes
     * through `getActiveWorkflowContext`, which queries the global pool, and
     * this callback already holds a pooled connection.
     *
     * `packages/db/tx-tripwire.ts` detects exactly that and throws outside
     * production, so it did not degrade quietly — it 500'd every
     * `/api/workflows/[id]/deploy` in dev, reported against the authz lookup
     * rather than anything this function wrote. Hoisting the read into the
     * transaction is the tripwire's own first remedy.
     */
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
    if (!active?.state || !active.workspaceId) return false

    const currentState = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    if (!currentState) return false

    const deployedState = await materializeDeploymentState(
      workflowId,
      active,
      active.workspaceId,
      tx
    )

    return hasWorkflowChanged(currentState, deployedState as WorkflowState)
  })
}
