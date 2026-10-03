import { workflowDeploymentVersion, workspaceForkWorkflowSync } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { WorkflowDeploymentOperation } from '@/lib/workflows/persistence/deployment-operations'

export interface ForkSourceVersion {
  id: string
  version: number
}

export type ForkWorkflowComparison =
  | { status: 'available'; base: ForkSourceVersion; target: ForkSourceVersion }
  | {
      status: 'unavailable'
      reason: 'new_workflow' | 'no_baseline' | 'missing_baseline'
      target: ForkSourceVersion
    }

/** Records activation facts inside the deployment's fenced cutover transaction. */
export async function activateForkSyncProvenance(
  tx: DbOrTx,
  operation: WorkflowDeploymentOperation
): Promise<void> {
  const now = new Date()
  await tx
    .update(workspaceForkWorkflowSync)
    .set({ activatedAt: now })
    .where(
      and(
        eq(workspaceForkWorkflowSync.deploymentOperationId, operation.id),
        eq(workspaceForkWorkflowSync.targetWorkflowId, operation.workflowId),
        isNull(workspaceForkWorkflowSync.activatedAt)
      )
    )
  await tx
    .update(workspaceForkWorkflowSync)
    .set({ rolledBackAt: now })
    .where(
      and(
        eq(workspaceForkWorkflowSync.rollbackOperationId, operation.id),
        eq(workspaceForkWorkflowSync.targetWorkflowId, operation.workflowId),
        isNull(workspaceForkWorkflowSync.rolledBackAt)
      )
    )
}

/** Binds only this undo's records; a completed partial undo remains completed on retry. */
export async function bindForkSyncRollback(
  tx: DbOrTx,
  promoteRunId: string,
  operation: WorkflowDeploymentOperation
): Promise<void> {
  await tx
    .update(workspaceForkWorkflowSync)
    .set({
      rollbackOperationId: operation.id,
      ...(operation.status === 'active' ? { rolledBackAt: new Date() } : {}),
    })
    .where(
      and(
        eq(workspaceForkWorkflowSync.promoteRunId, promoteRunId),
        eq(workspaceForkWorkflowSync.targetWorkflowId, operation.workflowId),
        isNull(workspaceForkWorkflowSync.rolledBackAt)
      )
    )
}

/** An undeploy cuts over synchronously, in the caller's rollback transaction. */
export async function undeployForkSyncProvenance(
  tx: DbOrTx,
  promoteRunId: string,
  workflowId: string
): Promise<void> {
  await tx
    .update(workspaceForkWorkflowSync)
    .set({ rolledBackAt: new Date() })
    .where(
      and(
        eq(workspaceForkWorkflowSync.promoteRunId, promoteRunId),
        eq(workspaceForkWorkflowSync.targetWorkflowId, workflowId),
        isNull(workspaceForkWorkflowSync.rolledBackAt)
      )
    )
}

/** Resolves one baseline per requested pair before looking up its possibly deleted snapshot. */
export async function loadForkWorkflowComparisons(
  executor: DbOrTx,
  childWorkspaceId: string,
  items: readonly {
    sourceWorkflowId: string
    targetWorkflowId: string
    mode: 'create' | 'replace'
  }[],
  sourceVersions: ReadonlyMap<string, ForkSourceVersion>
): Promise<Map<string, ForkWorkflowComparison>> {
  if (!items.length) return new Map()
  const pairs = sql.join(
    items.map((item) => sql`(${item.sourceWorkflowId}::text, ${item.targetWorkflowId}::text)`),
    sql`, `
  )
  const rows = await executor.execute<{
    sourceWorkflowId: string
    sourceDeploymentVersionId: string | null
    version: number | null
  }>(sql`
    SELECT pair.source_id AS "sourceWorkflowId", baseline.source_deployment_version_id AS "sourceDeploymentVersionId", version.version
    FROM (VALUES ${pairs}) AS pair(source_id, target_id)
    LEFT JOIN LATERAL (
      SELECT source_deployment_version_id FROM ${workspaceForkWorkflowSync}
      WHERE child_workspace_id = ${childWorkspaceId}
        AND source_workflow_id = pair.source_id AND target_workflow_id = pair.target_id
        AND activated_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY sequence DESC LIMIT 1
    ) baseline ON true
    LEFT JOIN ${workflowDeploymentVersion} version
      ON version.id = baseline.source_deployment_version_id AND version.workflow_id = pair.source_id
  `)
  const baselines = new Map(rows.map((row) => [row.sourceWorkflowId, row]))
  return new Map(
    items.map((item) => {
      const target = sourceVersions.get(item.sourceWorkflowId)
      if (!target) throw new Error('Sync comparison is missing its admitted source version')
      const baseline = baselines.get(item.sourceWorkflowId)
      const current = { id: target.id, version: target.version }
      let comparison: ForkWorkflowComparison
      if (item.mode === 'create') {
        comparison = { status: 'unavailable', reason: 'new_workflow', target: current }
      } else if (!baseline?.sourceDeploymentVersionId) {
        comparison = { status: 'unavailable', reason: 'no_baseline', target: current }
      } else if (baseline.version === null) {
        comparison = { status: 'unavailable', reason: 'missing_baseline', target: current }
      } else {
        comparison = {
          status: 'available',
          base: { id: baseline.sourceDeploymentVersionId, version: baseline.version },
          target: current,
        }
      }
      return [item.sourceWorkflowId, comparison]
    })
  )
}
