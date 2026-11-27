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

/** The active deployment's version, and whether the draft has diverged from it. */
export interface DeploymentDrift {
  /** The live version, or `null` when nothing is deployed. */
  deployedVersion: number | null
  /** False when nothing is deployed: read it beside {@link deployedVersion}. */
  needsRedeployment: boolean
}

/** What a workflow with no active deployment reports: no live version, so nothing to redeploy. */
export const UNDEPLOYED: DeploymentDrift = { deployedVersion: null, needsRedeployment: false }

/**
 * Reports the active deployment's version and whether the durable draft has diverged from it.
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
export async function readDeploymentDrift(workflowId: string): Promise<DeploymentDrift> {
  const snapshot = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    const deployed = await loadActiveDeployedState(tx, workflowId)
    if (!deployed) return null
    return { deployed, currentState: await loadWorkflowDeploymentSnapshot(workflowId, tx) }
  })

  if (!snapshot) return UNDEPLOYED
  const { deployed, currentState } = snapshot
  return {
    deployedVersion: deployed.version,
    needsRedeployment: currentState !== null && differsFromDeployed(currentState, deployed.state),
  }
}

/** Whether the durable draft has diverged from the active deployment; false when none is active. */
export async function checkNeedsRedeployment(workflowId: string): Promise<boolean> {
  return (await readDeploymentDrift(workflowId)).needsRedeployment
}

/**
 * {@link readDeploymentDrift} for `draft`, a draft not written yet: what a dry run answers, since
 * it stores nothing for the stored draft to be loaded from. `draft` must be in the shape a write
 * stores (`prepareWorkflowStateForPersistence`, with the variables the write leaves), built from
 * the stored draft as loaded, so the two compare as stored states do.
 */
export async function readDraftDeploymentDrift(
  workflowId: string,
  draft: WorkflowState
): Promise<DeploymentDrift> {
  const deployed = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    return loadActiveDeployedState(tx, workflowId)
  })
  if (!deployed) return UNDEPLOYED
  return {
    deployedVersion: deployed.version,
    needsRedeployment: differsFromDeployed(draft, deployed.state),
  }
}

/** {@link hasWorkflowChanged} against a deployed state, whose variables are untyped JSON. */
function differsFromDeployed(draft: WorkflowState, deployed: DeployedWorkflowData): boolean {
  return hasWorkflowChanged(draft, deployed as WorkflowState)
}

/**
 * The active deployment's version and state, through the same projection the draft load applies;
 * `null` when the workflow has no usable active deployment.
 *
 * `workspaceId` is selected here, in the caller's transaction, rather than left for
 * `materializeDeploymentState` to look up: resolving an absent one goes through
 * `getActiveWorkflowContext`, which queries the global pool while this transaction holds a pooled
 * connection, which `packages/db/tx-tripwire.ts` refuses outside production.
 */
async function loadActiveDeployedState(
  tx: DbOrTx,
  workflowId: string
): Promise<{ version: number; state: DeployedWorkflowData } | null> {
  const [active] = await tx
    .select({
      id: workflowDeploymentVersion.id,
      version: workflowDeploymentVersion.version,
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
  return {
    version: active.version,
    state: await materializeDeploymentState(workflowId, active, active.workspaceId, tx),
  }
}
