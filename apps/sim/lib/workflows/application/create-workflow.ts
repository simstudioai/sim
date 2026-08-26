import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import {
  resolveWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('CreateWorkflow')

export interface CreateWorkflowInput {
  workspaceId: string
  name: string
  description?: string | null
  folderPath?: string
  folderId?: string | null
}

export const createWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.create,
  resolveContext: ({ input }: { input: CreateWorkflowInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    if (input.folderPath !== undefined && input.folderId !== undefined) {
      throw new OrchestrationError('validation', 'Provide either folderPath or folderId, not both')
    }
    const resolution =
      input.folderId === undefined
        ? await resolveWorkflowFolderPath(context.workspaceId, input.folderPath ?? '/')
        : {
            folderId: input.folderId,
            index: await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
              maxRows: MAX_FOLDERS_PER_WORKSPACE,
            }),
          }
    if (resolution.folderId && !resolution.index.pathById.has(resolution.folderId)) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }
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
    const normalizedState = await loadWorkflowFromNormalizedTables(transition.workflow.id)
    if (!normalizedState) throw new Error('Successful workflow create returned no workflow state')

    logger.info('Created workflow', {
      workspaceId: context.workspaceId,
      workflowId: transition.workflow.id,
      principalKind: principal.kind,
    })
    return {
      workflow: transition.workflow,
      folderPath: workflowFolderPathForId(resolution.index, transition.workflow.folderId),
      normalizedState,
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
  async afterSuccess({ result }) {
    await notifyWorkflowUpdated(result.workflow.id)
    try {
      PlatformEvents.workflowCreated({
        workflowId: result.workflow.id,
        name: result.workflow.name,
        workspaceId: result.workflow.workspaceId,
        folderId: result.workflow.folderId ?? undefined,
      })
    } catch (error) {
      logger.warn('Failed to capture workflow created telemetry', {
        workflowId: result.workflow.id,
        error,
      })
    }
  },
})
