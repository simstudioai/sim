import { workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  DEPLOYMENT_READINESS_COMPONENTS,
  enqueueWorkflowDeploymentPreparation,
} from '@/lib/workflows/deployment-outbox'
import { prepareWorkflowVersionActivation } from '@/lib/workflows/persistence/deployment-operations'
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
   * Newly enqueued event. Reused idempotent operations already own a durable event.
   */
  outboxEventId?: string
}

/**
 * Prepare a prior deployment version for v2 activation and restore the workflow's
 * draft to it using only DB writes against the provided transaction.
 *
 * Deliberately does NOT call `assertWorkflowMutable`: a rollback is an admin force-undo
 * and must not be blocked by a workflow/folder lock (that check is also not tx-safe).
 * Idempotent: preparing the activation and overwriting the draft yield the same
 * prepared operation and draft on retry; the cutover itself happens asynchronously
 * through the deployment outbox.
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

  let outboxEventId: string | undefined
  const prepared = await prepareWorkflowVersionActivation({
    workflowId,
    deploymentVersionId: versionRow.id,
    actorId: userId,
    requestHash: sha256Hex(JSON.stringify({ action: 'activate', workflowId, version, userId })),
    idempotencyKey: `${requestId}:${workflowId}:reactivate:${version}`,
    readinessComponents: DEPLOYMENT_READINESS_COMPONENTS,
    tx,
    onPrepareTransaction: async (innerTx, operation) => {
      if (!operation.deploymentVersionId || operation.version === null) {
        throw new Error('Prepared rollback activation is missing its target version')
      }
      outboxEventId = await enqueueWorkflowDeploymentPreparation(innerTx, {
        protocolVersion: operation.protocolVersion,
        operationId: operation.id,
        generation: operation.generation,
        workflowId: operation.workflowId,
        deploymentVersionId: operation.deploymentVersionId,
        version: operation.version,
        userId,
        requestId,
        checkpoints: {},
      })
    },
  })
  if (!prepared.success) {
    throw new Error(prepared.error)
  }
  return { deploymentVersionId: versionRow.id, outboxEventId }
}
