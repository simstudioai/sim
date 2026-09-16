import { db } from '@sim/db'
import { outboxEvent, workflowDeploymentOperation, workspaceOperationReceipt } from '@sim/db/schema'
import { truncate } from '@sim/utils/string'
import { and, eq, inArray } from 'drizzle-orm'
import {
  isDeploymentOperationStatus,
  parseDeploymentReadiness,
} from '@/lib/workflows/deployment-lifecycle'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'

/** Projects the exact admitted attempts, preserving their terminal outcome in the lifetime receipt. */
export async function refreshWorkspaceOperation(
  workspaceId: string,
  operationId: string
): Promise<WorkspaceOperationReport | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ report: workspaceOperationReceipt.report })
      .from(workspaceOperationReceipt)
      .where(
        and(
          eq(workspaceOperationReceipt.workspaceId, workspaceId),
          eq(workspaceOperationReceipt.id, operationId)
        )
      )
      .for('update')
      .limit(1)
    if (!row) return null
    const report = row.report as WorkspaceOperationReport
    if (report.completionRecorded) return report
    const ids = report.deploymentOperationIds ?? []
    const attempts = ids.length
      ? await tx
          .select({
            id: workflowDeploymentOperation.id,
            workflowId: workflowDeploymentOperation.workflowId,
            status: workflowDeploymentOperation.status,
            version: workflowDeploymentOperation.version,
            readiness: workflowDeploymentOperation.componentReadiness,
            errorCode: workflowDeploymentOperation.errorCode,
            errorMessage: workflowDeploymentOperation.errorMessage,
          })
          .from(workflowDeploymentOperation)
          .where(inArray(workflowDeploymentOperation.id, ids))
      : []
    const addIssue = (code: string, message: string, workflowId?: string) => {
      if (!report.issues.some((issue) => issue.code === code && issue.workflowId === workflowId))
        report.issues.push({
          code,
          message: truncate(message, 2048),
          ...(workflowId ? { workflowId } : {}),
        })
    }
    if (attempts.length !== ids.length)
      addIssue(
        'deployment_receipt_missing',
        'An admitted deployment is no longer available; its readiness could not be verified'
      )
    report.deployments = attempts.map((attempt) => {
      if (!isDeploymentOperationStatus(attempt.status))
        throw new Error('Unknown stored deployment status')
      if (attempt.status === 'failed' || attempt.status === 'superseded')
        addIssue(
          'deployment_failed',
          attempt.errorMessage ?? `The admitted deployment was ${attempt.status}`,
          attempt.workflowId
        )
      const components = parseDeploymentReadiness(attempt.readiness)
      const validComponents = components && Object.keys(components).length > 0
      const pendingComponents = Object.entries(
        validComponents ? components : { unknown: { status: 'pending' } }
      )
        .filter(([, readiness]) => readiness.status !== 'ready')
        .map(([name]) => name)
      if (attempt.status === 'active' && pendingComponents.length > 0)
        addIssue(
          'deployment_readiness_invalid',
          'Deployment readiness could not be verified',
          attempt.workflowId
        )
      return {
        operationId: attempt.id,
        workflowId: attempt.workflowId,
        version: attempt.version,
        status: attempt.status,
        ready: attempt.status === 'active' && pendingComponents.length === 0,
        pendingComponents,
      }
    })
    if (report.copyProgress?.status === 'pending') {
      const [event] = report.contentOutboxEventId
        ? await tx
            .select({ status: outboxEvent.status })
            .from(outboxEvent)
            .where(eq(outboxEvent.id, report.contentOutboxEventId))
            .limit(1)
        : []
      if (!event || event.status === 'dead_letter' || event.status === 'completed') {
        report.copyProgress = {
          ...report.copyProgress,
          status: 'failed',
          failed: Math.max(1, report.copyProgress.failed),
        }
        addIssue(
          'resource_copy_failed',
          'Resource copy stopped before recording completion; the workspace changes remain committed'
        )
      }
    }
    const effectIds = report.effectEventIds ?? []
    const effects = effectIds.length
      ? await tx
          .select({ id: outboxEvent.id, status: outboxEvent.status })
          .from(outboxEvent)
          .where(inArray(outboxEvent.id, effectIds))
      : []
    const effectFailed =
      effects.length !== effectIds.length || effects.some((event) => event.status === 'dead_letter')
    if (effectFailed)
      addIssue(
        'follow_up_failed',
        'An admitted background effect failed; the workspace changes remain committed'
      )
    const effectsPending = effects.some(
      (event) => event.status === 'pending' || event.status === 'processing'
    )
    const pending =
      effectsPending ||
      report.copyProgress?.status === 'pending' ||
      report.deployments.some(
        (attempt) => attempt.status === 'preparing' || attempt.status === 'activating'
      )
    const failed =
      effectFailed ||
      report.copyProgress?.status === 'failed' ||
      report.issues.some((issue) =>
        [
          'deployment_failed',
          'deployment_admission_failed',
          'deployment_receipt_missing',
          'resource_copy_failed',
          'deployment_readiness_invalid',
        ].includes(issue.code)
      )
    report.status = pending
      ? 'processing'
      : failed
        ? 'failed'
        : report.issues.some((issue) => issue.code === 'required_configuration')
          ? 'requires_configuration'
          : report.issues.length
            ? 'completed_with_warnings'
            : 'completed'
    report.completionRecorded = !pending
    await tx
      .update(workspaceOperationReceipt)
      .set({ report, updatedAt: new Date() })
      .where(eq(workspaceOperationReceipt.id, operationId))
    return report
  })
}
