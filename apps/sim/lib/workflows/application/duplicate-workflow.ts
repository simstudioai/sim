import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  resolveWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import { duplicateWorkflow as duplicateWorkflowRecord } from '@/lib/workflows/persistence/duplicate'

export interface DuplicateWorkflowInput {
  sourceWorkflowId: string
  assertedWorkspaceId?: string
  /** Canonical destination folder. Mutually exclusive with `folderPath`. */
  folderId?: string | null
  /** Destination folder by path, resolved against the workspace's folder tree. */
  folderPath?: string
  /** Defaults to the source workflow's name, deduplicated within the destination folder. */
  name?: string
}

export const duplicateWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.duplicate,
  resolveContext: ({ principal, input }: { principal: Principal; input: DuplicateWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.sourceWorkflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    if (input.folderPath !== undefined && input.folderId !== undefined) {
      throw new OrchestrationError('validation', 'Provide either folderPath or folderId, not both')
    }
    const resolution =
      input.folderPath === undefined
        ? {
            folderId: input.folderId === undefined ? context.workflow.folderId : input.folderId,
            index: await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
              maxRows: MAX_FOLDERS_PER_WORKSPACE,
            }),
          }
        : await resolveWorkflowFolderPath(context.workspaceId, input.folderPath)
    if (resolution.folderId && !resolution.index.pathById.has(resolution.folderId)) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const duplicated = await db.transaction((tx) =>
      duplicateWorkflowRecord({
        sourceWorkflowId: context.workflowId,
        userId: attribution.attributedUserId,
        workspaceId: context.workspaceId,
        folderId: resolution.folderId,
        name: input.name ?? context.workflow.name,
        requestId: generateRequestId(),
        tx,
      })
    )
    return {
      ...duplicated,
      folderPath: workflowFolderPathForId(resolution.index, duplicated.folderId),
    }
  },
  projectAudit: ({ principal, context, result }) => ({
    action: AuditAction.WORKFLOW_DUPLICATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: result.id,
    resourceName: result.name,
    description: `Duplicated workflow "${context.workflow.name}" as "${result.name}"`,
    metadata: {
      sourceWorkflowId: context.workflowId,
      workspaceId: context.workspaceId,
      source: principalAuditSource(principal),
    },
  }),
  afterSuccess: ({ result }) => notifyWorkflowUpdated(result.id),
})
