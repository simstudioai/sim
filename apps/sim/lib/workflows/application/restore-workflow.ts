import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveArchivedWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { workflowFolderPathForId } from '@/lib/workflows/application/workflow-folders'
import { restoreWorkflow as restoreWorkflowRecord } from '@/lib/workflows/lifecycle'

const logger = createLogger('RestoreWorkflow')

export interface RestoreWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
}

/**
 * Brings an archived workflow, and the schedules, webhooks, MCP tools, and chats
 * archived alongside it, back to active.
 *
 * Calls the lifecycle primitive rather than `performRestoreWorkflow`: that
 * orchestration records its own audit row keyed on a bare `userId`, which cannot
 * represent a workspace-key or delegated principal. Audit is projected here
 * instead, from the authoritative restored row.
 */
export const restoreWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.restore,
  resolveContext: ({ principal, input }: { principal: Principal; input: RestoreWorkflowInput }) =>
    resolveArchivedWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, context }) {
    if (context.workflow.locked) {
      throw new OrchestrationError('locked', 'Workflow is locked')
    }
    try {
      await assertFolderMutable(context.workflow.folderId)
    } catch (error) {
      if (error instanceof FolderLockedError || error instanceof WorkflowLockedError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    }

    const restored = await restoreWorkflowRecord(context.workflowId, {
      requestId: generateRequestId(),
    })
    if (!restored.workflow) {
      throw new OrchestrationError('not_found', 'Workflow not found')
    }
    if (!restored.restored) {
      throw new OrchestrationError('conflict', 'Workflow is not archived')
    }

    const folderIndex = await loadActiveFolderPathIndex(
      context.workspaceId,
      'workflow',
      undefined,
      { maxRows: MAX_FOLDERS_PER_WORKSPACE }
    )
    logger.info('Restored workflow', {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      principalKind: principal.kind,
    })
    return {
      workflow: restored.workflow,
      workspaceId: context.workspaceId,
      folderPath: workflowFolderPathForId(folderIndex, restored.workflow.folderId),
    }
  },
  projectAudit: ({ principal, context, result }) => ({
    action: AuditAction.WORKFLOW_RESTORED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: context.workflowId,
    resourceName: result.workflow.name,
    description: `Restored workflow "${result.workflow.name}"`,
    metadata: {
      workflowName: result.workflow.name,
      workspaceId: context.workspaceId,
      source: principalAuditSource(principal),
    },
  }),
  afterSuccess: ({ context }) => notifyWorkflowUpdated(context.workflowId),
})
