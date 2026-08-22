import { db, workflowDeploymentVersion } from '@sim/db'
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
    const [active] = await tx
      .select({
        id: workflowDeploymentVersion.id,
        state: workflowDeploymentVersion.state,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (!active?.state) return false

    /*
     * Sequential, not `Promise.all`: both reads share the transaction's single
     * connection, which cannot serve concurrent statements.
     */
    const currentState = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    if (!currentState) return false

    const deployedState = await materializeDeploymentState(workflowId, active, undefined, tx)

    return hasWorkflowChanged(currentState, deployedState as WorkflowState)
  })
}
