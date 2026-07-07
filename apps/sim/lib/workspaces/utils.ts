import { db } from '@sim/db'
import { member, permissions, workflow, workspace as workspaceTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('WorkspaceUtils')

export interface WorkspaceBillingSettings {
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

/**
 * Workspaces the user administers purely through organization owner/admin role,
 * with no explicit permission row required. Empty when the user is not an org
 * owner/admin. Implements the workspace-permission inheritance model.
 *
 * Accepts an optional executor so callers already inside a transaction (e.g. a
 * workspace-archival safety check) can run this against `tx` instead of `db`.
 */
export async function getOrgAdminWorkspaceRows(
  userId: string,
  scope: WorkspaceScope = 'active',
  executor: DbOrTx = db
): Promise<Array<typeof workspaceTable.$inferSelect>> {
  const [membership] = await executor
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  if (!membership || !isOrgAdminRole(membership.role)) {
    return []
  }

  const orgFilter = eq(workspaceTable.organizationId, membership.organizationId)
  const where =
    scope === 'all'
      ? orgFilter
      : scope === 'archived'
        ? and(orgFilter, sql`${workspaceTable.archivedAt} IS NOT NULL`)
        : and(orgFilter, isNull(workspaceTable.archivedAt))

  return executor.select().from(workspaceTable).where(where).orderBy(desc(workspaceTable.createdAt))
}

/**
 * Every workspace a user can access: explicit permission grants plus workspaces
 * derived from organization owner/admin role. Deduped with explicit rows first.
 *
 * Accepts an optional executor so callers already inside a transaction can run
 * this against `tx` instead of `db`.
 */
export async function listAccessibleWorkspaceRowsForUser(
  userId: string,
  scope: WorkspaceScope = 'active',
  executor: DbOrTx = db
): Promise<
  Array<{ workspace: typeof workspaceTable.$inferSelect; permissionType: PermissionType }>
> {
  const explicit = await executor
    .select({ workspace: workspaceTable, permissionType: permissions.permissionType })
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

  const orgRows = await getOrgAdminWorkspaceRows(userId, scope, executor)
  if (orgRows.length === 0) {
    return explicit
  }

  const orgWorkspaceIds = new Set(orgRows.map((ws) => ws.id))
  const seen = new Set(explicit.map((row) => row.workspace.id))

  const elevatedExplicit = explicit.map((row) =>
    orgWorkspaceIds.has(row.workspace.id) ? { ...row, permissionType: 'admin' as const } : row
  )
  const derived = orgRows
    .filter((ws) => !seen.has(ws.id))
    .map((ws) => ({ workspace: ws, permissionType: 'admin' as const }))

  return [...elevatedExplicit, ...derived]
}

export async function listUserWorkspaces(userId: string, scope: WorkspaceScope = 'active') {
  const rows = await listAccessibleWorkspaceRowsForUser(userId, scope)

  return rows.map(({ workspace: ws, permissionType }) => ({
    workspaceId: ws.id,
    workspaceName: ws.name,
    role: ws.ownerId === userId ? 'owner' : permissionType,
  }))
}

export interface ReassignBilledAccountResult {
  reassigned: Array<{ workspaceId: string; newBilledAccountUserId: string }>
  unresolved: string[]
}

export interface ReassignWorkflowOwnershipResult {
  reassigned: Array<{ workspaceId: string; newWorkflowUserId: string; workflowCount: number }>
  unresolved: string[]
}

export const WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR =
  'Cannot remove the workspace billing account. Please reassign billing first.'

export class WorkspaceBillingAccountRemovalError extends Error {
  constructor() {
    super(WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR)
    this.name = 'WorkspaceBillingAccountRemovalError'
  }
}

export async function transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx({
  tx,
  workspaceId,
  departingUserId,
}: {
  tx: DbOrTx
  workspaceId: string
  departingUserId: string
}): Promise<boolean> {
  const [workspaceRow] = await tx
    .select({
      ownerId: workspaceTable.ownerId,
      billedAccountUserId: workspaceTable.billedAccountUserId,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1)

  if (!workspaceRow || workspaceRow.ownerId !== departingUserId) {
    return false
  }

  const newOwnerId = workspaceRow.billedAccountUserId
  if (!newOwnerId || newOwnerId === departingUserId) {
    throw new WorkspaceBillingAccountRemovalError()
  }

  await tx
    .update(workspaceTable)
    .set({ ownerId: newOwnerId, updatedAt: new Date() })
    .where(eq(workspaceTable.id, workspaceId))

  const [existingNewOwnerPermission] = await tx
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, newOwnerId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .limit(1)

  if (existingNewOwnerPermission) {
    await tx
      .update(permissions)
      .set({ permissionType: 'admin', updatedAt: new Date() })
      .where(eq(permissions.id, existingNewOwnerPermission.id))
    return true
  }

  const now = new Date()
  await tx.insert(permissions).values({
    id: generateId(),
    userId: newOwnerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
    createdAt: now,
    updatedAt: now,
  })

  return true
}

/**
 * Reassigns workflows owned by a user who is about to lose access to one or more workspaces.
 *
 * Workflow execution, webhook provider config, and environment variables intentionally resolve
 * through `workflow.userId`, so that identity must remain an active workspace identity. The
 * replacement is the workspace billed account: the same stable identity used for server-side
 * billing/permission actor resolution, and one the member-removal routes protect from removal.
 */
export async function reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
  tx,
  workspaceIds,
  departingUserId,
}: {
  tx: DbOrTx
  workspaceIds: string[]
  departingUserId: string
}): Promise<ReassignWorkflowOwnershipResult> {
  const uniqueWorkspaceIds = Array.from(new Set(workspaceIds.filter(Boolean)))
  if (uniqueWorkspaceIds.length === 0) {
    return { reassigned: [], unresolved: [] }
  }

  const workspaceRows = await tx
    .select({
      id: workspaceTable.id,
      billedAccountUserId: workspaceTable.billedAccountUserId,
    })
    .from(workspaceTable)
    .where(inArray(workspaceTable.id, uniqueWorkspaceIds))

  const reassigned: ReassignWorkflowOwnershipResult['reassigned'] = []
  const unresolved: string[] = []
  const reassignmentWorkspaceIds: string[] = []
  const workflowCounts = await tx
    .select({
      workspaceId: workflow.workspaceId,
      workflowCount: count(workflow.id),
    })
    .from(workflow)
    .where(
      and(eq(workflow.userId, departingUserId), inArray(workflow.workspaceId, uniqueWorkspaceIds))
    )
    .groupBy(workflow.workspaceId)

  const workflowCountsByWorkspaceId = new Map<string, number>()
  for (const { workspaceId, workflowCount } of workflowCounts) {
    if (!workspaceId || workflowCount === 0) continue
    workflowCountsByWorkspaceId.set(workspaceId, workflowCount)
  }

  for (const ws of workspaceRows) {
    const workflowCount = workflowCountsByWorkspaceId.get(ws.id) ?? 0
    if (workflowCount === 0) {
      continue
    }

    const replacementUserId =
      ws.billedAccountUserId !== departingUserId ? ws.billedAccountUserId : null

    if (!replacementUserId) {
      unresolved.push(ws.id)
      continue
    }

    reassignmentWorkspaceIds.push(ws.id)
  }

  if (reassignmentWorkspaceIds.length > 0) {
    await tx
      .update(workflow)
      .set({
        userId: sql<string>`(
          select ${workspaceTable.billedAccountUserId}
          from ${workspaceTable}
          where ${workspaceTable.id} = ${workflow.workspaceId}
        )`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflow.userId, departingUserId),
          inArray(workflow.workspaceId, reassignmentWorkspaceIds)
        )
      )

    const billedAccountByWorkspaceId = new Map(
      workspaceRows.map((ws) => [ws.id, ws.billedAccountUserId])
    )
    for (const workspaceId of reassignmentWorkspaceIds) {
      const workflowCount = workflowCountsByWorkspaceId.get(workspaceId) ?? 0
      const newWorkflowUserId = billedAccountByWorkspaceId.get(workspaceId)
      if (!newWorkflowUserId) continue
      reassigned.push({
        workspaceId,
        newWorkflowUserId,
        workflowCount,
      })
    }
  }

  if (reassigned.length > 0 || unresolved.length > 0) {
    logger.info('Reassigned workflow ownership for removed workspace member', {
      departingUserId,
      reassigned,
      unresolved,
    })
  }

  return { reassigned, unresolved }
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

export interface ReassignOwnedWorkspacesResult {
  reassigned: Array<{ workspaceId: string; newOwnerId: string }>
  unresolved: string[]
}

/**
 * Reassigns `ownerId` on every workspace owned by `departingUserId` to another
 * eligible user, so the user can be deleted without the `workspace.owner_id`
 * `ON DELETE CASCADE` silently deleting their workspaces.
 *
 * Preference order for the replacement:
 *  1. The workspace billed account (if different from the departing user)
 *  2. Any other workspace admin
 *
 * Returns workspaces that could not be reassigned (no distinct billed account and
 * no other admin). Callers MUST block user deletion when `unresolved.length > 0`
 * so the cascade can never nuke a workspace.
 */
export async function reassignOwnedWorkspacesForUser(
  departingUserId: string
): Promise<ReassignOwnedWorkspacesResult> {
  const ownedWorkspaces = await db
    .select({
      id: workspaceTable.id,
      billedAccountUserId: workspaceTable.billedAccountUserId,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.ownerId, departingUserId))

  if (ownedWorkspaces.length === 0) {
    return { reassigned: [], unresolved: [] }
  }

  const reassigned: ReassignOwnedWorkspacesResult['reassigned'] = []
  const unresolved: string[] = []

  for (const ws of ownedWorkspaces) {
    let replacement: string | null =
      ws.billedAccountUserId !== departingUserId ? ws.billedAccountUserId : null

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

    const now = new Date()
    await db
      .update(workspaceTable)
      .set({ ownerId: replacement, updatedAt: now })
      .where(eq(workspaceTable.id, ws.id))

    // Owners are admins — guarantee the new owner holds an admin permission row.
    await db
      .insert(permissions)
      .values({
        id: generateId(),
        userId: replacement,
        entityType: 'workspace',
        entityId: ws.id,
        permissionType: 'admin',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [permissions.userId, permissions.entityType, permissions.entityId],
        set: { permissionType: 'admin', updatedAt: now },
      })

    reassigned.push({ workspaceId: ws.id, newOwnerId: replacement })
  }

  if (reassigned.length > 0) {
    logger.info('Reassigned workspace ownership for departing user', {
      departingUserId,
      reassignedCount: reassigned.length,
      unresolvedCount: unresolved.length,
    })
  }

  return { reassigned, unresolved }
}
