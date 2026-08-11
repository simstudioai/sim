import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db, workflow } from '@sim/db'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  PublicApiNotAllowedError,
  validatePublicApiAllowed,
} from '@/ee/access-control/utils/permission-check'

export interface UpdateWorkflowPublicApiInput {
  workflowId: string
  assertedWorkspaceId?: string
  isPublicApi: boolean
}

export const updateWorkflowPublicApi = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.updatePublicApi,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateWorkflowPublicApiInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    if (principal.kind !== 'session') {
      throw new Error('Workflow public API settings require a session principal')
    }
    try {
      await assertWorkflowMutable(context.workflowId)
      if (input.isPublicApi) {
        await validatePublicApiAllowed(principal.userId, context.workspaceId)
      }
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        throw new OrchestrationError('locked', error.message)
      }
      if (error instanceof PublicApiNotAllowedError) {
        throw new OrchestrationError('forbidden', 'Public API access is disabled')
      }
      throw error
    }

    const [updated] = await db
      .update(workflow)
      .set({ isPublicApi: input.isPublicApi })
      .where(eq(workflow.id, context.workflowId))
      .returning({ id: workflow.id })
    if (!updated) throw new OrchestrationError('not_found', 'Workflow not found')
    return {
      workflowId: context.workflowId,
      workflowName: context.workflow.name,
      workspaceId: context.workspaceId,
      isPublicApi: input.isPublicApi,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.WORKFLOW_PUBLIC_API_TOGGLED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: result.workflowId,
    resourceName: result.workflowName,
    description: `${result.isPublicApi ? 'Enabled' : 'Disabled'} public API for workflow "${result.workflowName}"`,
    metadata: { isPublicApi: result.isPublicApi },
  }),
  afterSuccess: ({ result }) => notifyWorkflowUpdated(result.workflowId),
})
