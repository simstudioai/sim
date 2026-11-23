import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { principalAuditSource } from '@/lib/core/application'
import { notifyWorkflowUpdated, notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import { recordSourceWritten } from '@/lib/workflows/application/source-analytics'
import type { SourceOutcome } from '@/lib/workflows/application/source-pipeline/outcome'

/** Where a source write says it came from: a self-reported client, and the git commit it read. */
export interface SourceProvenance {
  client: 'cli' | 'copilot' | 'canvas' | 'api'
  gitSha?: string
  repo?: string
}

/** The analytics facts of a source write or dry run. */
export function sourceAnalyticsFacts(
  principal: Principal,
  provenance: SourceProvenance | undefined,
  operation: 'apply' | 'create',
  workspaceId: string,
  dryRun: boolean
) {
  return { principal, client: provenance?.client, operation, workspaceId, dryRun }
}

/** The audit metadata a committed source write records, for update and create alike. */
function sourceAuditMetadata(
  principal: Principal,
  provenance: SourceProvenance | undefined,
  result: SourceOutcome
) {
  const { blocks, edges, variables } = result.diff
  return {
    op: 'apply_source',
    blocksAdded: blocks.added.length,
    blocksRemoved: blocks.removed.length,
    blocksRenamed: blocks.renamed.length,
    blocksModified: blocks.modified.length,
    edgesAdded: edges.added,
    edgesRemoved: edges.removed,
    variablesChanged:
      variables.added.length +
      variables.removed.length +
      variables.renamed.length +
      variables.modified.length,
    sdkMajor: result.sdkMajor,
    catalogHash: result.base.catalogHash,
    ...(provenance ? { client: provenance.client } : {}),
    ...(provenance?.gitSha ? { gitSha: provenance.gitSha } : {}),
    ...(provenance?.repo ? { repo: provenance.repo } : {}),
    source: principalAuditSource(principal),
  }
}

/** The audit of a source write to a stored workflow: only a committed, non-empty one. */
export function sourceApplyAudit(
  principal: Principal,
  provenance: SourceProvenance | undefined,
  workflowId: string,
  result: SourceOutcome
) {
  return result.applied
    ? ({
        action: AuditAction.WORKFLOW_UPDATED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: workflowId,
        resourceName: result.workflowName,
        description: `Applied workflow source to workflow "${result.workflowName}"`,
        metadata: sourceAuditMetadata(principal, provenance, result),
      } as const)
    : []
}

/** The audit of a workflow created from source: only a committed one. */
export function sourceCreateAudit(
  principal: Principal,
  provenance: SourceProvenance | undefined,
  result: SourceOutcome
) {
  return result.applied
    ? ({
        action: AuditAction.WORKFLOW_CREATED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: result.workflowId,
        resourceName: result.workflowName,
        description: `Created workflow "${result.workflowName}" from source`,
        metadata: sourceAuditMetadata(principal, provenance, result),
      } as const)
    : []
}

/**
 * After a source write to a stored workflow: records a committed write and notifies. Source meta
 * alone changes what an open Code tab prints, so it notifies too.
 */
export async function afterSourceApply(
  principal: Principal,
  provenance: SourceProvenance | undefined,
  context: { workflowId: string; workspaceId: string },
  result: SourceOutcome
): Promise<void> {
  if (result.applied) {
    recordSourceWritten(
      sourceAnalyticsFacts(principal, provenance, 'apply', context.workspaceId, result.dryRun),
      result
    )
  }
  if (!result.applied && !result.wroteSourceMeta) return
  await Promise.all([
    notifyWorkflowUpdated(context.workflowId),
    // A rename or new description changes how the workspace lists the workflow.
    result.applied && result.diff.meta?.length
      ? notifyWorkspaceWorkflowsChanged(context.workspaceId)
      : undefined,
  ])
}

/** After a workflow is created from source: records the write and notifies. */
export async function afterSourceCreate(
  principal: Principal,
  provenance: SourceProvenance | undefined,
  result: SourceOutcome
): Promise<void> {
  if (!result.applied) return
  recordSourceWritten(
    sourceAnalyticsFacts(principal, provenance, 'create', result.workspaceId, result.dryRun),
    result
  )
  await Promise.all([
    notifyWorkflowUpdated(result.workflowId),
    notifyWorkspaceWorkflowsChanged(result.workspaceId),
  ])
}
