import { workflow, workspaceForkWorkflowSync } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { isFolderPathEffectivelyLocked } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { prepareWorkflowSnapshotDeployment } from '@/lib/workflows/orchestration/deploy'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'

export interface PrepareForkDeploymentsParams {
  childWorkspaceId: string
  targetWorkspaceId: string
  promoteRunId: string
  items: readonly { sourceWorkflowId: string; targetWorkflowId: string }[]
  sourceVersions: ReadonlyMap<string, { id: string }>
  needsConfigurationIds: ReadonlySet<string>
  userId: string
  requestId: string
  workspaceOperationId?: string
}

export type PreparedForkDeployment = Awaited<ReturnType<typeof prepareWorkflowSnapshotDeployment>>

/** Admits copied graphs and their source provenance together, before releasing the sync locks. */
export async function prepareForkSyncDeployments(
  tx: DbOrTx,
  params: PrepareForkDeploymentsParams
): Promise<Map<string, PreparedForkDeployment>> {
  const results = new Map<string, PreparedForkDeployment>()
  const items = params.items.filter(
    (item) => !params.needsConfigurationIds.has(item.targetWorkflowId)
  )
  if (!items.length) return results
  const folders = await loadActiveFolderPathIndex(params.targetWorkspaceId, 'workflow', tx, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
  const targets = await tx
    .select({ id: workflow.id, locked: workflow.locked, folderId: workflow.folderId })
    .from(workflow)
    .where(
      inArray(
        workflow.id,
        items.map((item) => item.targetWorkflowId)
      )
    )
  const byId = new Map(targets.map((target) => [target.id, target]))
  for (const item of [...items].sort((a, b) =>
    compareStrings(a.targetWorkflowId, b.targetWorkflowId)
  )) {
    const workflowId = item.targetWorkflowId
    const target = byId.get(workflowId)
    if (!target) throw new Error('A synced workflow is missing its admitted target')
    if (
      target.locked ||
      (target.folderId && isFolderPathEffectivelyLocked(folders, target.folderId))
    ) {
      results.set(workflowId, {
        success: false,
        error: target.locked ? 'Workflow is locked' : 'Workflow is locked by its containing folder',
        errorCode: 'locked',
      })
      continue
    }
    const sourceVersion = params.sourceVersions.get(item.sourceWorkflowId)
    if (!sourceVersion) throw new Error('A synced workflow is missing its admitted source version')
    const workflowState = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    if (!workflowState) throw new Error('A synced workflow is missing its admitted graph')
    const prepared = await prepareWorkflowSnapshotDeployment({
      params: { workflowId, userId: params.userId, requestId: params.requestId },
      actorId: params.userId,
      requestId: params.requestId,
      idempotencyKey: `${params.promoteRunId}:${workflowId}`,
      workflowState,
      tx,
      workspaceOperationId: params.workspaceOperationId,
    })
    if (prepared.success)
      await tx.insert(workspaceForkWorkflowSync).values({
        deploymentOperationId: prepared.operation.id,
        childWorkspaceId: params.childWorkspaceId,
        sourceWorkflowId: item.sourceWorkflowId,
        targetWorkflowId: workflowId,
        sourceDeploymentVersionId: sourceVersion.id,
        promoteRunId: params.promoteRunId,
      })
    results.set(workflowId, prepared)
  }
  return results
}
