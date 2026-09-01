import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowDeleted, notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { deleteWorkflowRecord } from '@/lib/workflows/orchestration'

const logger = createLogger('DeleteWorkflow')

export interface DeleteWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
}

export const deleteWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.delete,
  resolveContext: ({ principal, input }: { principal: Principal; input: DeleteWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, context }) {
    try {
      await assertWorkflowMutable(context.workflowId)
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    }

    const transition = await deleteWorkflowRecord({
      workflowId: context.workflowId,
      userId: resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      }).attributedUserId,
      notifySocket: false,
    })
    requireWorkflowTransition(transition, 'Failed to delete workflow')
    if (!transition.workflow) throw new Error('Successful workflow delete returned no workflow')

    logger.info('Deleted workflow', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      archived: transition.archived,
      principalKind: principal.kind,
    })
    return {
      workflowId: context.workflowId,
      workflowName: transition.workflow.name,
      workspaceId: context.workspaceId,
      archived: transition.archived === true,
    }
  },
  projectAudit: ({ result }) =>
    result.archived
      ? {
          action: AuditAction.WORKFLOW_DELETED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: result.workflowId,
          resourceName: result.workflowName,
          description: `Archived workflow "${result.workflowName}"`,
          metadata: { archived: true },
        }
      : [],
  async afterSuccess({ context, result }) {
    if (!result.archived) return
    await Promise.all([
      notifyWorkflowDeleted(context.workflowId),
      notifyWorkspaceWorkflowsChanged(context.workspaceId),
    ])
  },
})
