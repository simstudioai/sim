import { db, workflowDeploymentVersion } from '@sim/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Compares the current durable draft with the active deployment snapshot. */
export function computeNeedsRedeployment(
  currentSnapshot: WorkflowState | null | undefined,
  activeState: WorkflowState | null | undefined
): boolean {
  if (!activeState || !currentSnapshot) return false
  return hasWorkflowChanged(currentSnapshot, activeState)
}

/** Reads both sides at repeatable-read isolation so the comparison is coherent. */
export async function checkNeedsRedeployment(workflowId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    const [active] = await tx
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    const currentState = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    return computeNeedsRedeployment(currentState, (active?.state as WorkflowState) ?? null)
  })
}
