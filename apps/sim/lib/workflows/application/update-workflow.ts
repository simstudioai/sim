import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
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
}

export const updateWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.update,
  resolveContext: ({ principal, input }: { principal: Principal; input: UpdateWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    const resolution =
      input.folderPath === undefined
        ? undefined
        : await resolveWorkflowFolderPath(context.workspaceId, input.folderPath)

    try {
      await assertWorkflowMutable(context.workflowId)
      if (resolution) await assertFolderMutable(resolution.folderId)
    } catch (error) {
      if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    }

    const transition = await updateWorkflowRecord({
      workflowId: context.workflowId,
      userId: resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      }).attributedUserId,
      workspaceId: context.workspaceId,
      currentName: context.workflow.name,
      currentFolderId: context.workflow.folderId,
      name: input.name,
      description: input.description,
      folderId: resolution?.folderId,
    })
    requireWorkflowTransition(transition, 'Failed to update workflow')
    if (!transition.workflow) throw new Error('Successful workflow update returned no workflow')

    const folderIndex =
      resolution?.index ??
      (await loadActiveFolderPathIndex(context.workspaceId, 'workflow', undefined, {
        maxRows: MAX_FOLDERS_PER_WORKSPACE,
      }))
    logger.info('Updated workflow', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      principalKind: principal.kind,
    })
    return {
      workflow: transition.workflow,
      workspaceId: context.workspaceId,
      folderPath: workflowFolderPathForId(folderIndex, transition.workflow.folderId),
      deployment: {
        isDeployed: context.workflow.isDeployed,
        deployedAt: context.workflow.deployedAt,
        runCount: context.workflow.runCount,
        lastRunAt: context.workflow.lastRunAt,
      },
    }
  },
})
