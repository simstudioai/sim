import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

export type WorkflowEvalAccessAction = 'read' | 'write'

export interface WorkflowEvalAccess {
  workflowId: string
  workspaceId: string
  userId: string
}

export class WorkflowEvalAccessError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'WorkflowEvalAccessError'
  }
}

export async function authorizeWorkflowEvalAccess({
  workflowId,
  userId,
  action,
  expectedWorkspaceId,
}: {
  workflowId: string
  userId: string
  action: WorkflowEvalAccessAction
  expectedWorkspaceId?: string
}): Promise<WorkflowEvalAccess> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action,
  })

  if (!authorization.workflow) {
    throw new WorkflowEvalAccessError(`Workflow ${workflowId} was not found`, 404)
  }
  if (!authorization.allowed) {
    throw new WorkflowEvalAccessError(
      authorization.message || `Access denied for workflow ${workflowId}`,
      authorization.status
    )
  }

  const workspaceId = authorization.workflow.workspaceId
  if (!workspaceId) {
    throw new Error(`Workflow ${workflowId} is not attached to a workspace`)
  }
  if (expectedWorkspaceId && expectedWorkspaceId !== workspaceId) {
    throw new WorkflowEvalAccessError(
      `Workflow ${workflowId} is not in workspace ${expectedWorkspaceId}`,
      403
    )
  }

  const [workspaceRow] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!workspaceRow) {
    throw new Error(`Workspace ${workspaceId} was not found for workflow ${workflowId}`)
  }

  const enabled = await isFeatureEnabled('workflow-evals', {
    userId,
    orgId: workspaceRow.organizationId ?? undefined,
  })
  if (!enabled) {
    throw new WorkflowEvalAccessError('Workflow evals are not enabled', 403)
  }

  return { workflowId, workspaceId, userId }
}
