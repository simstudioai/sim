import { db } from '@sim/db'
import { permissions, workflow, workspace } from '@sim/db/schema'
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'

type WorkflowRecord = typeof workflow.$inferSelect

export async function ensureWorkflowAccess(
  workflowId: string,
  userId: string
): Promise<{
  workflow: WorkflowRecord
  workspaceId?: string | null
}> {
  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!workflowRecord) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  if (workflowRecord.userId === userId) {
    return { workflow: workflowRecord, workspaceId: workflowRecord.workspaceId }
  }

  if (workflowRecord.workspaceId) {
    const [permissionRow] = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflowRecord.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .limit(1)
    if (permissionRow) {
      return { workflow: workflowRecord, workspaceId: workflowRecord.workspaceId }
    }
  }

  throw new Error('Unauthorized workflow access')
}

export async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const workspaces = await db
    .select({ workspaceId: workspace.id })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))
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
  const [row] = await db
    .select({
      permissionType: permissions.permissionType,
      ownerId: workspace.ownerId,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .limit(1)

  if (!row) {
    throw new Error(`Workspace ${workspaceId} not found`)
  }

  const isOwner = row.ownerId === userId
  const permissionType = row.permissionType
  const canWrite = isOwner || permissionType === 'admin' || permissionType === 'write'

  if (requireWrite && !canWrite) {
    throw new Error('Write or admin access required for this workspace')
  }

  if (!requireWrite && !canWrite && permissionType !== 'read') {
    throw new Error('Access denied to workspace')
  }
}

export async function getAccessibleWorkflowsForUser(
  userId: string,
  options?: { workspaceId?: string; folderId?: string }
) {
  const workspaceIds = await db
    .select({ entityId: permissions.entityId })
    .from(permissions)
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))

  const workspaceIdList = workspaceIds.map((row) => row.entityId)

  const workflowConditions = [eq(workflow.userId, userId)]
  if (workspaceIdList.length > 0) {
    workflowConditions.push(inArray(workflow.workspaceId, workspaceIdList))
  }
  if (options?.workspaceId) {
    workflowConditions.push(eq(workflow.workspaceId, options.workspaceId))
  }
  if (options?.folderId) {
    workflowConditions.push(eq(workflow.folderId, options.folderId))
  }

  return db
    .select()
    .from(workflow)
    .where(or(...workflowConditions))
    .orderBy(asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id))
}

