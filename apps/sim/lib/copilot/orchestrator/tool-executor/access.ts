import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { authorizeWorkflowByWorkspacePermission, type getWorkflowById } from '@/lib/workflows/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

type WorkflowRecord = NonNullable<Awaited<ReturnType<typeof getWorkflowById>>>

export async function ensureWorkflowAccess(
  workflowId: string,
  userId: string
): Promise<{
  workflow: WorkflowRecord
  workspaceId?: string | null
}> {
  const result = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'read',
  })

  if (!result.workflow) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  if (!result.allowed) {
    throw new Error(result.message || 'Unauthorized workflow access')
  }

  return { workflow: result.workflow, workspaceId: result.workflow.workspaceId }
}

export async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const workspaces = await db
    .select({ workspaceId: workspace.id })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        isNull(workspace.archivedAt)
      )
    )
    .orderBy(desc(workspace.createdAt))
    .limit(1)

  const workspaceId = workspaces[0]?.workspaceId
  if (!workspaceId) {
    throw new Error('No workspace found for user')
  }

  return workspaceId
}

export async function ensureWorkspaceAccess(
  workspaceId: string,
  userId: string,
  requireWrite: boolean
): Promise<void> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error(`Workspace ${workspaceId} not found`)
  }

  const permissionType = access.canWrite
    ? 'write'
    : access.workspace?.ownerId === userId
      ? 'admin'
      : 'read'
  const canWrite = permissionType === 'admin' || permissionType === 'write'

  if (requireWrite && !canWrite) {
    throw new Error('Write or admin access required for this workspace')
  }

  if (!requireWrite && !canWrite && permissionType !== 'read') {
    throw new Error('Access denied to workspace')
  }
}
