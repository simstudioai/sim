import { db, workflowDeploymentVersion } from '@sim/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { materializeWorkflowComparisonState } from '@/lib/workflows/persistence/comparison-state'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const MAX_COMPARISON_BYTES = 16 * 1024 * 1024

/** Loads at most two immutable snapshots from one workflow, admitting bytes in the same transaction. */
export async function loadWorkflowComparisonVersions(
  workflowId: string,
  workspaceId: string,
  base: number,
  target: number
): Promise<{ base: WorkflowState; target: WorkflowState }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`)
    const requested = [...new Set([base, target])]
    const predicate = and(
      eq(workflowDeploymentVersion.workflowId, workflowId),
      inArray(workflowDeploymentVersion.version, requested)
    )
    const sizes = await tx
      .select({
        version: workflowDeploymentVersion.version,
        bytes: sql<number>`octet_length(${workflowDeploymentVersion.state}::text)`,
      })
      .from(workflowDeploymentVersion)
      .where(predicate)
      .limit(2)
    if (sizes.length !== requested.length)
      throw new OrchestrationError('not_found', 'Deployment version not found')
    if (sizes.reduce((total, row) => total + Number(row.bytes), 0) > MAX_COMPARISON_BYTES) {
      throw new OrchestrationError(
        'payload_too_large',
        'Deployment versions exceed the 16 MiB comparison limit'
      )
    }
    const rows = await tx
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        state: workflowDeploymentVersion.state,
      })
      .from(workflowDeploymentVersion)
      .where(predicate)
      .limit(2)
    const states = new Map<number, WorkflowState>()
    for (const row of rows) {
      states.set(
        row.version,
        await materializeWorkflowComparisonState(workflowId, row, workspaceId, tx)
      )
    }
    const baseState = states.get(base)
    const targetState = states.get(target)
    if (!baseState || !targetState)
      throw new OrchestrationError('not_found', 'Deployment version not found')
    return { base: baseState, target: targetState }
  })
}
