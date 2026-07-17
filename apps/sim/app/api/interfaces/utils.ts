import { db } from '@sim/db'
import { workflow, workflowInterface } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'

export async function checkWorkflowAccessForInterfaceCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: { id: string; workspaceId: string | null } }> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'admin',
  })

  if (!authorization.workflow) {
    return { hasAccess: false }
  }

  if (authorization.allowed) {
    return { hasAccess: true, workflow: authorization.workflow }
  }

  return { hasAccess: false }
}

export async function checkInterfaceAccess(
  interfaceId: string,
  userId: string
): Promise<{
  hasAccess: boolean
  interfaceRow?: typeof workflowInterface.$inferSelect
  workspaceId?: string
}> {
  const rows = await db
    .select({
      interfaceRow: workflowInterface,
      workflowWorkspaceId: workflow.workspaceId,
    })
    .from(workflowInterface)
    .innerJoin(workflow, eq(workflowInterface.workflowId, workflow.id))
    .where(and(eq(workflowInterface.id, interfaceId), isNull(workflowInterface.archivedAt)))
    .limit(1)

  if (rows.length === 0) {
    return { hasAccess: false }
  }

  const { interfaceRow, workflowWorkspaceId } = rows[0]
  if (!workflowWorkspaceId) {
    return { hasAccess: false }
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: interfaceRow.workflowId,
    userId,
    action: 'admin',
  })

  return authorization.allowed
    ? { hasAccess: true, interfaceRow, workspaceId: workflowWorkspaceId }
    : { hasAccess: false }
}
