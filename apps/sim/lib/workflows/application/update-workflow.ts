import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import type { WorkspaceUseCaseAuditEntry } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import {
  resolveWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import { updateWorkflowRecord } from '@/lib/workflows/orchestration'

const logger = createLogger('UpdateWorkflow')

export interface UpdateWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
  name?: string
  description?: string | null
  folderPath?: string
  folderId?: string | null
  sortOrder?: number
}

export interface UpdateWorkflowPolicyInput extends UpdateWorkflowInput {
  locked?: boolean
  forkSyncExcluded?: boolean
}

export type AppliedWorkflowUpdate =
  | 'name'
  | 'description'
  | 'folder'
  | 'sortOrder'
  | 'locked'
  | 'forkSyncExcluded'

interface WorkflowUpdateResult {
  workflow: NonNullable<Awaited<ReturnType<typeof updateWorkflowRecord>>['workflow']>
  workspaceId: string
  folderPath: string
  changes: AppliedWorkflowUpdate[]
  deployment: {
    isDeployed: boolean
    deployedAt: Date | null
    runCount: number
    lastRunAt: Date | null
  }
}

function resolveWorkflowUpdateContext({
  principal,
  input,
}: {
  principal: Principal
  input: UpdateWorkflowInput
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

async function requireMutableWorkflowUpdate(
  context: ActiveWorkflowApplicationContext,
  input: UpdateWorkflowPolicyInput,
  targetFolderId: string | null | undefined
): Promise<void> {
  const hasContentUpdate =
    input.name !== undefined ||
    input.description !== undefined ||
    input.folderPath !== undefined ||
    input.folderId !== undefined ||
    input.sortOrder !== undefined
  try {
    if (hasContentUpdate) await assertWorkflowMutable(context.workflowId)
    if (targetFolderId !== undefined) await assertFolderMutable(targetFolderId)
  } catch (error) {
    if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }
}

function changedFields(
  input: UpdateWorkflowPolicyInput,
  context: ActiveWorkflowApplicationContext,
  updated: NonNullable<Awaited<ReturnType<typeof updateWorkflowRecord>>['workflow']>
): AppliedWorkflowUpdate[] {
  const changes: AppliedWorkflowUpdate[] = []
  if (input.name !== undefined && updated.name !== context.workflow.name) changes.push('name')
  if (
    input.description !== undefined &&
    updated.description !== (context.workflow.description ?? null)
  ) {
    changes.push('description')
  }
  if (
    (input.folderPath !== undefined || input.folderId !== undefined) &&
    updated.folderId !== (context.workflow.folderId ?? null)
  ) {
    changes.push('folder')
  }
  if (input.sortOrder !== undefined && updated.sortOrder !== context.workflow.sortOrder) {
    changes.push('sortOrder')
  }
  if (input.locked !== undefined && updated.locked !== context.workflow.locked) {
    changes.push('locked')
  }
  if (
    input.forkSyncExcluded !== undefined &&
    updated.forkSyncExcluded !== context.workflow.forkSyncExcluded
  ) {
    changes.push('forkSyncExcluded')
  }
  return changes
}

async function executeWorkflowUpdate(args: {
  principal: Principal
  input: UpdateWorkflowPolicyInput
  context: ActiveWorkflowApplicationContext
}): Promise<WorkflowUpdateResult> {
  const { principal, input, context } = args
  if (input.folderPath !== undefined && input.folderId !== undefined) {
    throw new OrchestrationError('validation', 'Provide either folderPath or folderId, not both')
  }
  const resolution =
    input.folderId !== undefined
      ? {
          folderId: input.folderId,
          index: await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
            maxRows: MAX_FOLDERS_PER_WORKSPACE,
          }),
        }
      : input.folderPath === undefined
        ? undefined
        : await resolveWorkflowFolderPath(context.workspaceId, input.folderPath)
  if (resolution?.folderId && !resolution.index.pathById.has(resolution.folderId)) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }
  await requireMutableWorkflowUpdate(context, input, resolution?.folderId)

  const transition = await updateWorkflowRecord({
    workflowId: context.workflowId,
    userId: resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId,
    workspaceId: context.workspaceId,
    currentName: context.workflow.name,
    currentFolderId: context.workflow.folderId,
    currentLocked: context.workflow.locked,
    currentForkSyncExcluded: context.workflow.forkSyncExcluded,
    name: input.name,
    description: input.description,
    folderId: resolution?.folderId,
    sortOrder: input.sortOrder,
    locked: input.locked,
    forkSyncExcluded: input.forkSyncExcluded,
  })
  requireWorkflowTransition(transition, 'Failed to update workflow')
  if (!transition.workflow) throw new Error('Successful workflow update returned no workflow')

  const folderIndex =
    resolution?.index ??
    (await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    }))
  const changes = changedFields(input, context, transition.workflow)
  logger.info('Updated workflow', {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    principalKind: principal.kind,
    changes,
  })
  return {
    workflow: transition.workflow,
    workspaceId: context.workspaceId,
    folderPath: workflowFolderPathForId(folderIndex, transition.workflow.folderId),
    changes,
    deployment: {
      isDeployed: context.workflow.isDeployed,
      deployedAt: context.workflow.deployedAt,
      runCount: context.workflow.runCount,
      lastRunAt: context.workflow.lastRunAt,
    },
  }
}

function projectWorkflowUpdateAudit(args: {
  input: UpdateWorkflowPolicyInput
  context: ActiveWorkflowApplicationContext
  result: WorkflowUpdateResult
}): WorkspaceUseCaseAuditEntry[] {
  const { input, context, result } = args
  const entries: WorkspaceUseCaseAuditEntry[] = []
  const metadataChanges = result.changes.filter(
    (field) => field !== 'locked' && field !== 'forkSyncExcluded'
  )
  if (metadataChanges.length > 0) {
    entries.push({
      action: AuditAction.WORKFLOW_UPDATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: context.workflowId,
      resourceName: result.workflow.name,
      description: `Updated workflow "${result.workflow.name}"`,
      metadata: { updatedFields: metadataChanges },
    })
  }
  if (result.changes.includes('locked')) {
    entries.push({
      action: input.locked ? AuditAction.WORKFLOW_LOCKED : AuditAction.WORKFLOW_UNLOCKED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: context.workflowId,
      resourceName: result.workflow.name,
      description: `${input.locked ? 'Locked' : 'Unlocked'} workflow "${result.workflow.name}"`,
      metadata: { locked: input.locked },
    })
  }
  if (result.changes.includes('forkSyncExcluded')) {
    entries.push({
      action: input.forkSyncExcluded
        ? AuditAction.WORKFLOW_FORK_SYNC_EXCLUDED
        : AuditAction.WORKFLOW_FORK_SYNC_INCLUDED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: context.workflowId,
      resourceName: result.workflow.name,
      description: `${input.forkSyncExcluded ? 'Excluded' : 'Included'} workflow "${result.workflow.name}" ${input.forkSyncExcluded ? 'from' : 'in'} fork sync`,
      metadata: { forkSyncExcluded: input.forkSyncExcluded },
    })
  }
  return entries
}

function notifyAfterWorkflowUpdate(args: {
  context: ActiveWorkflowApplicationContext
  result: WorkflowUpdateResult
}) {
  return args.result.changes.length > 0 ? notifyWorkflowUpdated(args.context.workflowId) : undefined
}

export const updateWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.update,
  resolveContext: resolveWorkflowUpdateContext,
  execute: executeWorkflowUpdate,
  projectAudit: projectWorkflowUpdateAudit,
  afterSuccess: notifyAfterWorkflowUpdate,
})

export const updateWorkflowPolicy = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.updatePolicy,
  resolveContext: resolveWorkflowUpdateContext,
  execute: executeWorkflowUpdate,
  projectAudit: projectWorkflowUpdateAudit,
  afterSuccess: notifyAfterWorkflowUpdate,
})
