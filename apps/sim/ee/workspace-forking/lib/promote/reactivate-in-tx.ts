import { workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { enqueueWorkflowDeploymentSideEffects } from '@/lib/workflows/deployment-outbox'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface ReactivateDeployedVersionParams {
  tx: DbOrTx
  workflowId: string
  version: number
  userId: string
  requestId: string
}

export interface ReactivateDeployedVersionResult {
  deploymentVersionId: string
  /**
   * Outbox event id enqueued inside the transaction. Process it AFTER the tx commits
   * (or rely on the outbox cron/reaper if the process dies first).
   */
  outboxEventId: string
}

/**
 * Reactivate a prior deployment version AND restore the workflow's draft to it using
 * ONLY DB writes against the provided transaction, enqueuing the deployment
 * side-effect (webhook / schedule / MCP re-subscription) to the outbox for processing
 * AFTER the tx commits. This composes the DB halves of {@link activateWorkflowVersion}
 * and `performRevertToVersion` so a fork rollback can run atomically under its fork
 * advisory lock - the heavy side-effects never run inside the locked tx.
 *
 * Deliberately does NOT call `assertWorkflowMutable`: a rollback is an admin force-undo
 * and must not be blocked by a workflow/folder lock (that check is also not tx-safe).
 * Idempotent: deactivate-all + activate-target + overwrite-draft yield the same state
 * on retry.
 *
 * Returns null when the target version row no longer exists, so the caller can mark the
 * workflow skipped rather than failing the whole rollback.
 */
export async function reactivateDeployedVersionInTx(
  params: ReactivateDeployedVersionParams
): Promise<ReactivateDeployedVersionResult | null> {
  const { tx, workflowId, version, userId, requestId } = params
  const now = new Date()

  // Lock the workflow row so this serializes with a concurrent (unlocked) promote
  // deploy loop, which locks the same row in deployWorkflow - guaranteeing the final
  // (active version, draft) pair is always coherent regardless of commit order.
  await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
    .for('update')

  const [versionRow] = await tx
    .select({ id: workflowDeploymentVersion.id, state: workflowDeploymentVersion.state })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.version, version)
      )
    )
    .limit(1)

  if (!versionRow) return null

  const deployedState = versionRow.state as {
    blocks?: Record<string, unknown>
    edges?: unknown[]
    loops?: Record<string, unknown>
    parallels?: Record<string, unknown>
    variables?: WorkflowState['variables']
  }
  if (!deployedState.blocks || !deployedState.edges) {
    throw new Error(
      `Deployment version ${version} for workflow ${workflowId} has an invalid state structure`
    )
  }

  // Activate the target version (deactivate every other), mark the workflow deployed.
  await tx
    .update(workflowDeploymentVersion)
    .set({ isActive: false })
    .where(eq(workflowDeploymentVersion.workflowId, workflowId))
  await tx
    .update(workflowDeploymentVersion)
    .set({ isActive: true })
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.version, version)
      )
    )
  await tx
    .update(workflow)
    .set({ isDeployed: true, deployedAt: now })
    .where(eq(workflow.id, workflowId))

  // Restore the draft to the deployed version's state.
  const hasVariables = Object.hasOwn(deployedState, 'variables')
  const restoredState: WorkflowState = {
    blocks: deployedState.blocks,
    edges: deployedState.edges,
    loops: deployedState.loops || {},
    parallels: deployedState.parallels || {},
    lastSaved: now.getTime(),
  } as WorkflowState
  if (hasVariables) {
    restoredState.variables = deployedState.variables || {}
  }

  const saveResult = await saveWorkflowToNormalizedTables(workflowId, restoredState, tx)
  if (!saveResult.success) {
    throw new Error(saveResult.error || `Failed to restore draft for workflow ${workflowId}`)
  }

  await tx
    .update(workflow)
    .set({
      ...(hasVariables ? { variables: deployedState.variables || {} } : {}),
      lastSynced: now,
      updatedAt: now,
    })
    .where(eq(workflow.id, workflowId))

  const outboxEventId = await enqueueWorkflowDeploymentSideEffects(tx, {
    workflowId,
    deploymentVersionId: versionRow.id,
    userId,
    requestId,
    forceRecreateSubscriptions: true,
  })

  return { deploymentVersionId: versionRow.id, outboxEventId }
}
