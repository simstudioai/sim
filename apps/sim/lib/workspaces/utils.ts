import { db } from '@sim/db'
import { permissions, workspace as workspaceTable } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'

interface WorkspaceBillingSettings {
  billedAccountUserId: string | null
  allowPersonalApiKeys: boolean
}

export async function getWorkspaceBillingSettings(
  workspaceId: string
): Promise<WorkspaceBillingSettings | null> {
  if (!workspaceId) {
    return null
  }

  const rows = await db
    .select({
      billedAccountUserId: workspaceTable.billedAccountUserId,
      allowPersonalApiKeys: workspaceTable.allowPersonalApiKeys,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1)

  if (!rows.length) {
    return null
  }

  return {
    billedAccountUserId: rows[0].billedAccountUserId ?? null,
    allowPersonalApiKeys: rows[0].allowPersonalApiKeys ?? false,
  }
}

export async function getWorkspaceBilledAccountUserId(workspaceId: string): Promise<string | null> {
  const settings = await getWorkspaceBillingSettings(workspaceId)
  return settings?.billedAccountUserId ?? null
}

export async function listUserWorkspaces(userId: string) {
  const workspaces = await db
    .select({
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
      ownerId: workspaceTable.ownerId,
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .innerJoin(workspaceTable, eq(permissions.entityId, workspaceTable.id))
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))
    .orderBy(desc(workspaceTable.createdAt))

  return workspaces.map((row) => ({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    role: row.ownerId === userId ? 'owner' : row.permissionType,
  }))
}
