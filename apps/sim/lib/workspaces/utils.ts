import { db } from '@sim/db'
import { permissions, workspace as workspaceTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'

const logger = createLogger('WorkspaceUtils')

interface WorkspaceBillingSettings {
  billedAccountUserId: string | null
  allowPersonalApiKeys: boolean
}

export type WorkspaceScope = 'active' | 'archived' | 'all'

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
    .where(and(eq(workspaceTable.id, workspaceId), isNull(workspaceTable.archivedAt)))
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

export async function listUserWorkspaces(userId: string, scope: WorkspaceScope = 'active') {
  const workspaces = await db
    .select({
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
      ownerId: workspaceTable.ownerId,
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .innerJoin(workspaceTable, eq(permissions.entityId, workspaceTable.id))
    .where(
      scope === 'all'
        ? and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace'))
        : scope === 'archived'
          ? and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              sql`${workspaceTable.archivedAt} IS NOT NULL`
            )
          : and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              isNull(workspaceTable.archivedAt)
            )
    )
    .orderBy(desc(workspaceTable.createdAt))

  return workspaces.map((row) => ({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    role: row.ownerId === userId ? 'owner' : row.permissionType,
  }))
}

export interface ReassignBilledAccountResult {
  reassigned: Array<{ workspaceId: string; newBilledAccountUserId: string }>
  unresolved: string[]
}

/**
 * Reassigns `billedAccountUserId` on every workspace that points to `departingUserId` to
 * another eligible user, so the user can be deleted without violating the `workspace.billed_account_user_id`
 * foreign key (`ON DELETE NO ACTION`).
 *
 * Preference order for the replacement:
 *  1. The workspace owner (if different from the departing user)
 *  2. Any existing workspace admin
 *
 * Returns the list of workspaces that could not be reassigned (no owner + no admin). Callers should
 * block user deletion when `unresolved.length > 0` so we never leave an orphaned billing reference.
 */
export async function reassignBilledAccountForUser(
  departingUserId: string
): Promise<ReassignBilledAccountResult> {
  const billedWorkspaces = await db
    .select({
      id: workspaceTable.id,
      ownerId: workspaceTable.ownerId,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.billedAccountUserId, departingUserId))

  if (billedWorkspaces.length === 0) {
    return { reassigned: [], unresolved: [] }
  }

  const reassigned: ReassignBilledAccountResult['reassigned'] = []
  const unresolved: string[] = []

  for (const ws of billedWorkspaces) {
    let replacement: string | null = ws.ownerId !== departingUserId ? ws.ownerId : null

    if (!replacement) {
      const [admin] = await db
        .select({ userId: permissions.userId })
        .from(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, ws.id),
            eq(permissions.permissionType, 'admin'),
            ne(permissions.userId, departingUserId)
          )
        )
        .limit(1)

      replacement = admin?.userId ?? null
    }

    if (!replacement) {
      unresolved.push(ws.id)
      continue
    }

    await db
      .update(workspaceTable)
      .set({ billedAccountUserId: replacement, updatedAt: new Date() })
      .where(eq(workspaceTable.id, ws.id))

    reassigned.push({ workspaceId: ws.id, newBilledAccountUserId: replacement })
  }

  if (reassigned.length > 0) {
    logger.info('Reassigned workspace billed account for departing user', {
      departingUserId,
      reassignedCount: reassigned.length,
      unresolvedCount: unresolved.length,
    })
  }

  return { reassigned, unresolved }
}
