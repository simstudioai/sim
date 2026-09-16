import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { prepareWorkflowSnapshotDeployment } from '@/lib/workflows/orchestration/deploy'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import {
  insertWorkspaceOperationReceipt,
  type WorkspaceOperationReport,
} from '@/lib/workspaces/operations/receipts'
import { enqueueDurableForkContent } from '@/ee/workspace-forking/application/content-outbox'
import type { ForkMutationAdmission } from '@/ee/workspace-forking/application/revision'
import {
  type ForkContentCopyPayload,
  hasForkContentToCopy,
} from '@/ee/workspace-forking/lib/copy/content-copy-runner'
import type { PromoteForkResult } from '@/ee/workspace-forking/lib/promote/promote'

/** Persists the receipt, exact deployment versions, and resumable effects with the sync writes. */
export async function admitForkSync(
  tx: DbOrTx,
  params: {
    admission: ForkMutationAdmission
    targetWorkspaceId: string
    direction: 'push' | 'pull'
    userId: string
    result: Omit<PromoteForkResult, 'operation' | 'replayed'>
    targetIds: string[]
    undeployEventIds: string[]
    mcpAttachmentServerIds: string[]
    needsConfigurationIds: Set<string>
    copy?: ForkContentCopyPayload
  }
): Promise<WorkspaceOperationReport> {
  const { admission, result } = params
  const report: WorkspaceOperationReport = {
    operationId: generateId(),
    requestId: admission.requestId,
    workspaceId: admission.workspaceId,
    kind: params.direction === 'push' ? 'workspace_push' : 'workspace_pull',
    applied: true,
    status: 'processing',
    resourceIds: params.targetIds,
    deploymentOperationIds: [],
    issues: [],
    syncResult: result,
    effectEventIds: [...params.undeployEventIds],
    triggerUrlChanges: result.triggerUrlChanges,
  }
  for (const workflowId of params.needsConfigurationIds)
    report.issues.push({
      code: 'required_configuration',
      workflowId,
      message: 'Required dependent fields need destination configuration before deployment',
    })
  for (const entry of result.clearedOptional)
    report.issues.push({
      code: 'optional_configuration_cleared',
      message: truncate(`${entry.workflowName}: ${entry.blocks.join(', ')}`, 2048),
    })
  if (result.triggerUrlChanges.length)
    report.issues.push({
      code: 'trigger_url_changed',
      message: `${result.triggerUrlChanges.length} trigger URLs changed; inspect triggerUrlChanges before using this environment`,
    })
  if (result.droppedReferences.length)
    report.issues.push({
      code: 'references_dropped',
      message: `${result.droppedReferences.length} source-deleted references were explicitly cleared`,
    })
  if (params.copy && hasForkContentToCopy(params.copy.contentPlan, params.copy.blobTasks)) {
    report.copyProgress = { status: 'pending', copied: 0, failed: 0 }
    report.contentOutboxEventId = await enqueueDurableForkContent(tx, report, params.copy)
  }
  for (const workflowId of [...params.targetIds].sort()) {
    if (params.needsConfigurationIds.has(workflowId)) continue
    const workflowState = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    if (!workflowState) throw new Error('A synced workflow is missing its admitted graph')
    const prepared = await prepareWorkflowSnapshotDeployment({
      params: { workflowId, userId: params.userId, requestId: admission.requestId },
      actorId: params.userId,
      requestId: admission.requestId,
      idempotencyKey: `${report.operationId}:${workflowId}`,
      workflowState,
      tx,
      workspaceOperationId: report.operationId,
    })
    if (prepared.success) {
      report.deploymentOperationIds!.push(prepared.operation.id)
      if (prepared.outboxEventId) report.effectEventIds!.push(prepared.outboxEventId)
    } else
      report.issues.push({
        code: 'deployment_admission_failed',
        workflowId,
        message: prepared.error,
      })
  }
  if (params.mcpAttachmentServerIds.length)
    report.effectEventIds!.push(
      await enqueueOutboxEvent(tx, 'workspace.mcp.changed', {
        serverIds: params.mcpAttachmentServerIds,
      })
    )
  if (
    !report.deploymentOperationIds!.length &&
    !report.copyProgress &&
    !report.effectEventIds!.length
  ) {
    report.status = report.issues.some((issue) => issue.code === 'deployment_admission_failed')
      ? 'failed'
      : params.needsConfigurationIds.size
        ? 'requires_configuration'
        : report.issues.length
          ? 'completed_with_warnings'
          : 'completed'
  }
  await enqueueOutboxEvent(tx, 'workspace.workflows.changed', {
    workspaceId: params.targetWorkspaceId,
  })
  await enqueueOutboxEvent(tx, 'workspace.operation.observe', {
    workspaceId: report.workspaceId,
    operationId: report.operationId,
  })
  await insertWorkspaceOperationReceipt(tx, admission.requestHash, report)
  return report
}
