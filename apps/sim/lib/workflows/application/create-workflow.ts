import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import {
  resolveWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration'

const logger = createLogger('CreateWorkflow')

export interface CreateWorkflowInput {
  workspaceId: string
  name: string
  description?: string | null
  folderPath?: string
}

export const createWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.create,
  resolveContext: ({ input }: { input: CreateWorkflowInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const resolution = await resolveWorkflowFolderPath(context.workspaceId, input.folderPath ?? '/')
    try {
      await assertFolderMutable(resolution.folderId)
    } catch (error) {
      if (error instanceof FolderLockedError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const transition = await performCreateWorkflowTransition({
      userId: attribution.attributedUserId,
      workspaceId: context.workspaceId,
      name: input.name,
      description: input.description,
      folderId: resolution.folderId,
    })
    requireWorkflowTransition(transition, 'Failed to create workflow')
    if (!transition.workflow) throw new Error('Successful workflow create returned no workflow')

    logger.info('Created workflow', {
      workspaceId: context.workspaceId,
      workflowId: transition.workflow.id,
      principalKind: principal.kind,
    })
    return {
      workflow: transition.workflow,
      folderPath: workflowFolderPathForId(resolution.index, transition.workflow.folderId),
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.WORKFLOW_CREATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: result.workflow.id,
    resourceName: result.workflow.name,
    description: `Created workflow "${result.workflow.name}"`,
    metadata: {
      name: result.workflow.name,
      description: result.workflow.description || undefined,
      workspaceId: result.workflow.workspaceId,
      folderId: result.workflow.folderId || undefined,
      sortOrder: result.workflow.sortOrder,
    },
  }),
})
