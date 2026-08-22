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
     * `materializeDeploymentState` to look up. It resolves an absent one through
     * `getActiveWorkflowContext`, which runs on the global pool — a second
     * connection checkout while this transaction already holds one. Under any
     * concurrency (this endpoint is polled, and refetches on window focus) that
     * starves the pool and fails the nested read, surfacing as a 500 on
     * `/api/workflows/[id]/deploy`. A transaction must not await a checkout.
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

    /*
     * Sequential, not `Promise.all`: both reads share the transaction's single
     * connection, which cannot serve concurrent statements.
     */
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
