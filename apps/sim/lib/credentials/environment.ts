import { db } from '@sim/db'
import { credential, credentialMember, permissions, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

export interface WorkspaceMembership {
  ownerId: string | null
  /** All workspace members: the owner plus everyone with a workspace permission. */
  memberUserIds: string[]
  /** Subset of memberUserIds with admin-level workspace permission (owner + explicit admins). */
  adminUserIds: Set<string>
}

/**
 * Resolves a workspace's membership in one owner lookup + one permissions scan.
 * Credential-admin status is derived from workspace role at access time, so
 * members are seeded only for use access (the owner plus permission holders).
 */
export async function getWorkspaceMembership(workspaceId: string): Promise<WorkspaceMembership> {
  const [workspaceRows, permissionRows] = await Promise.all([
    db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({ userId: permissions.userId, permissionType: permissions.permissionType })
      .from(permissions)
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))),
  ])

  const ownerId = workspaceRows[0]?.ownerId ?? null
  const memberUserIds = new Set<string>(permissionRows.map((row) => row.userId))
  const adminUserIds = new Set<string>(
    permissionRows.filter((row) => row.permissionType === 'admin').map((row) => row.userId)
  )
  if (ownerId) {
    memberUserIds.add(ownerId)
    adminUserIds.add(ownerId)
  }

  return { ownerId, memberUserIds: Array.from(memberUserIds), adminUserIds }
}

export interface WorkspaceEnvKeyAdminAccess {
  /** Keys for which the caller is an active credential admin. */
  adminKeys: Set<string>
  /** Keys that already have an `env_workspace` credential (regardless of role). */
  knownKeys: Set<string>
}

/**
 * For a set of workspace env keys, resolves which the caller may administer
 * (active `credential_member` with role `admin`) and which already have an
 * `env_workspace` credential at all. Keys absent from `knownKeys` have no ACL
 * yet (new or legacy), letting routes fall back to a workspace-permission gate.
 */
export async function getWorkspaceEnvKeyAdminAccess(params: {
  workspaceId: string
  envKeys: string[]
  userId: string
}): Promise<WorkspaceEnvKeyAdminAccess> {
  const { workspaceId, envKeys, userId } = params
  const keys = Array.from(new Set(envKeys.filter(Boolean)))
  if (keys.length === 0) return { adminKeys: new Set(), knownKeys: new Set() }

  const rows = await db
    .select({
      envKey: credential.envKey,
      role: credentialMember.role,
      status: credentialMember.status,
    })
    .from(credential)
    .leftJoin(
      credentialMember,
      and(eq(credentialMember.credentialId, credential.id), eq(credentialMember.userId, userId))
    )
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'env_workspace'),
        inArray(credential.envKey, keys)
      )
    )

  const knownKeys = new Set<string>()
  const adminKeys = new Set<string>()
  for (const row of rows) {
    if (!row.envKey) continue
    knownKeys.add(row.envKey)
    if (row.role === 'admin' && row.status === 'active') adminKeys.add(row.envKey)
  }
  return { adminKeys, knownKeys }
}

interface AccessibleEnvCredential {
  type: 'env_workspace' | 'env_personal'
  envKey: string
  envOwnerUserId: string | null
  updatedAt: Date
}

export async function getUserWorkspaceIds(userId: string): Promise<string[]> {
  const [permissionRows, ownedWorkspaceRows] = await Promise.all([
    db
      .select({ workspaceId: workspace.id })
      .from(permissions)
      .innerJoin(
        workspace,
        and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspace.id))
      )
      .where(and(eq(permissions.userId, userId), isNull(workspace.archivedAt))),
    db
      .select({ workspaceId: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.ownerId, userId), isNull(workspace.archivedAt))),
  ])

  const workspaceIds = new Set<string>(permissionRows.map((row) => row.workspaceId))
  for (const row of ownedWorkspaceRows) {
    workspaceIds.add(row.workspaceId)
  }

  return Array.from(workspaceIds)
}

async function ensureWorkspaceCredentialMemberships(
  credentialId: string,
  memberUserIds: string[],
  invitedBy: string,
  adminUserIds: Set<string>
) {
  if (!memberUserIds.length) return

  const existingMemberships = await db
    .select({
      userId: credentialMember.userId,
      status: credentialMember.status,
    })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, credentialId),
        inArray(credentialMember.userId, memberUserIds)
      )
    )

  // Revoked memberships are filtered out so ON CONFLICT cannot resurrect them.
  const revokedUserIds = new Set<string>(
    existingMemberships.filter((row) => row.status === 'revoked').map((row) => row.userId)
  )
  const targetUserIds = memberUserIds.filter((id) => !revokedUserIds.has(id))
  if (targetUserIds.length === 0) return

  const now = new Date()
  const values = targetUserIds.map((memberUserId) => ({
    id: generateId(),
    credentialId,
    userId: memberUserId,
    role: (adminUserIds.has(memberUserId) ? 'admin' : 'member') as 'admin' | 'member',
    status: 'active' as const,
    joinedAt: now,
    invitedBy,
    createdAt: now,
    updatedAt: now,
  }))

  // Existing roles (including manual per-secret overrides) are preserved on
  // conflict; only membership activeness and a missing joinedAt are reconciled.
  await db
    .insert(credentialMember)
    .values(values)
    .onConflictDoUpdate({
      target: [credentialMember.credentialId, credentialMember.userId],
      set: {
        status: 'active',
        joinedAt: sql`COALESCE(${credentialMember.joinedAt}, excluded.joined_at)`,
        updatedAt: now,
      },
    })
}

export async function syncWorkspaceEnvCredentials(params: {
  workspaceId: string
  envKeys: string[]
  actingUserId: string
}) {
  const { workspaceId, envKeys, actingUserId } = params
  const { ownerId, memberUserIds, adminUserIds } = await getWorkspaceMembership(workspaceId)

  if (!ownerId) return

  const normalizedKeys = Array.from(new Set(envKeys.filter(Boolean)))
  const existingCredentials = await db
    .select({
      id: credential.id,
      envKey: credential.envKey,
    })
    .from(credential)
    .where(and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'env_workspace')))

  const existingByKey = new Map(
    existingCredentials
      .filter((row): row is { id: string; envKey: string } => Boolean(row.envKey))
      .map((row) => [row.envKey, row.id])
  )

  const credentialIdsToEnsureMembership = new Set<string>()
  const now = new Date()

  for (const envKey of normalizedKeys) {
    const existingId = existingByKey.get(envKey)
    if (existingId) credentialIdsToEnsureMembership.add(existingId)
  }

  const keysToCreate = normalizedKeys.filter((key) => !existingByKey.has(key))
  if (keysToCreate.length > 0) {
    const inserted = await db
      .insert(credential)
      .values(
        keysToCreate.map((envKey) => ({
          id: generateId(),
          workspaceId,
          type: 'env_workspace' as const,
          displayName: envKey,
          envKey,
          createdBy: actingUserId,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: credential.id })
    for (const row of inserted) {
      credentialIdsToEnsureMembership.add(row.id)
    }
  }

  for (const credentialId of credentialIdsToEnsureMembership) {
    await ensureWorkspaceCredentialMemberships(credentialId, memberUserIds, ownerId, adminUserIds)
  }

  if (normalizedKeys.length > 0) {
    await db
      .delete(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_workspace'),
          notInArray(credential.envKey, normalizedKeys)
        )
      )
    return
  }

  await db
    .delete(credential)
    .where(and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'env_workspace')))
}

/**
 * Creates credential records and bulk-inserts memberships for newly added workspace env keys.
 * Use this instead of `syncWorkspaceEnvCredentials` when the caller knows exactly which keys are new.
 */
export async function createWorkspaceEnvCredentials(params: {
  workspaceId: string
  newKeys: string[]
  actingUserId: string
}): Promise<void> {
  const { workspaceId, newKeys, actingUserId } = params
  const keys = Array.from(new Set(newKeys.filter(Boolean)))
  if (keys.length === 0) return

  const { ownerId, memberUserIds, adminUserIds } = await getWorkspaceMembership(workspaceId)

  if (!ownerId) return

  const now = new Date()

  const inserted = await db
    .insert(credential)
    .values(
      keys.map((envKey) => ({
        id: generateId(),
        workspaceId,
        type: 'env_workspace' as const,
        displayName: envKey,
        envKey,
        createdBy: actingUserId,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing()
    .returning({ id: credential.id })
  const createdIds = inserted.map((row) => row.id)

  if (createdIds.length === 0 || memberUserIds.length === 0) return

  // Bulk-insert memberships for all new credentials × all workspace members in one query
  const membershipValues = createdIds.flatMap((credentialId) =>
    memberUserIds.map((memberUserId) => ({
      id: generateId(),
      credentialId,
      userId: memberUserId,
      role: (adminUserIds.has(memberUserId) ? 'admin' : 'member') as 'admin' | 'member',
      status: 'active' as const,
      joinedAt: now,
      invitedBy: actingUserId,
      createdAt: now,
      updatedAt: now,
    }))
  )

  await db.insert(credentialMember).values(membershipValues).onConflictDoNothing()
}

/**
 * Deletes credential records (and their memberships via cascade) for removed workspace env keys.
 * Use this instead of `syncWorkspaceEnvCredentials` when the caller knows exactly which keys were deleted.
 */
export async function deleteWorkspaceEnvCredentials(params: {
  workspaceId: string
  removedKeys: string[]
}): Promise<void> {
  const { workspaceId, removedKeys } = params
  const keys = removedKeys.filter(Boolean)
  if (keys.length === 0) return

  await db
    .delete(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'env_workspace'),
        inArray(credential.envKey, keys)
      )
    )
}

export async function syncPersonalEnvCredentialsForUser(params: {
  userId: string
  envKeys: string[]
}): Promise<void> {
  const { userId, envKeys } = params
  const workspaceIds = await getUserWorkspaceIds(userId)
  if (!workspaceIds.length) return

  const normalizedKeys = Array.from(new Set(envKeys.filter(Boolean)))
  const now = new Date()

  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      if (normalizedKeys.length > 0) {
        await db
          .insert(credential)
          .values(
            normalizedKeys.map((envKey) => ({
              id: generateId(),
              workspaceId,
              type: 'env_personal' as const,
              displayName: envKey,
              envKey,
              envOwnerUserId: userId,
              createdBy: userId,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .onConflictDoNothing()
      }

      const currentCredentials =
        normalizedKeys.length > 0
          ? await db
              .select({ id: credential.id })
              .from(credential)
              .where(
                and(
                  eq(credential.workspaceId, workspaceId),
                  eq(credential.type, 'env_personal'),
                  eq(credential.envOwnerUserId, userId),
                  inArray(credential.envKey, normalizedKeys)
                )
              )
          : []

      if (currentCredentials.length > 0) {
        await db
          .insert(credentialMember)
          .values(
            currentCredentials.map(({ id: credentialId }) => ({
              id: generateId(),
              credentialId,
              userId,
              role: 'admin' as const,
              status: 'active' as const,
              joinedAt: now,
              invitedBy: userId,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .onConflictDoUpdate({
            target: [credentialMember.credentialId, credentialMember.userId],
            set: { role: 'admin', status: 'active', updatedAt: now },
          })
      }

      if (normalizedKeys.length > 0) {
        await db
          .delete(credential)
          .where(
            and(
              eq(credential.workspaceId, workspaceId),
              eq(credential.type, 'env_personal'),
              eq(credential.envOwnerUserId, userId),
              notInArray(credential.envKey, normalizedKeys)
            )
          )
      } else {
        await db
          .delete(credential)
          .where(
            and(
              eq(credential.workspaceId, workspaceId),
              eq(credential.type, 'env_personal'),
              eq(credential.envOwnerUserId, userId)
            )
          )
      }
    })
  )
}

export async function getAccessibleEnvCredentials(
  workspaceId: string,
  userId: string,
  options?: { isWorkspaceAdmin?: boolean }
): Promise<AccessibleEnvCredential[]> {
  const isWorkspaceAdmin =
    options?.isWorkspaceAdmin ?? (await hasWorkspaceAdminAccess(userId, workspaceId))

  const rows = await db
    .select({
      type: credential.type,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      updatedAt: credential.updatedAt,
    })
    .from(credential)
    .leftJoin(
      credentialMember,
      and(
        eq(credentialMember.credentialId, credential.id),
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active')
      )
    )
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        inArray(credential.type, ['env_workspace', 'env_personal']),
        or(
          isNotNull(credentialMember.id),
          eq(credential.envOwnerUserId, userId),
          isWorkspaceAdmin ? eq(credential.type, 'env_workspace') : undefined
        )
      )
    )

  return rows
    .filter(
      (row): row is typeof row & { type: 'env_workspace' | 'env_personal'; envKey: string } =>
        row.envKey !== null && (row.type === 'env_workspace' || row.type === 'env_personal')
    )
    .map((row) => ({
      type: row.type,
      envKey: row.envKey,
      envOwnerUserId: row.envOwnerUserId,
      updatedAt: row.updatedAt,
    }))
}

export interface AccessibleOAuthCredential {
  id: string
  providerId: string
  displayName: string
  role: 'admin' | 'member'
  updatedAt: Date
}

export async function getAccessibleOAuthCredentials(
  workspaceId: string,
  userId: string,
  options?: { isWorkspaceAdmin?: boolean }
): Promise<AccessibleOAuthCredential[]> {
  const isWorkspaceAdmin =
    options?.isWorkspaceAdmin ?? (await hasWorkspaceAdminAccess(userId, workspaceId))

  if (isWorkspaceAdmin) {
    const rows = await db
      .select({
        id: credential.id,
        providerId: credential.providerId,
        displayName: credential.displayName,
        updatedAt: credential.updatedAt,
      })
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          inArray(credential.type, ['oauth', 'service_account'])
        )
      )

    return rows
      .filter((row): row is typeof row & { providerId: string } => Boolean(row.providerId))
      .map((row) => ({
        id: row.id,
        providerId: row.providerId,
        displayName: row.displayName,
        role: 'admin' as const,
        updatedAt: row.updatedAt,
      }))
  }

  const rows = await db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
      role: credentialMember.role,
      updatedAt: credential.updatedAt,
    })
    .from(credential)
    .innerJoin(
      credentialMember,
      and(
        eq(credentialMember.credentialId, credential.id),
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active')
      )
    )
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        inArray(credential.type, ['oauth', 'service_account'])
      )
    )

  return rows
    .filter((row): row is AccessibleOAuthCredential => Boolean(row.providerId))
    .map((row) => ({
      id: row.id,
      providerId: row.providerId!,
      displayName: row.displayName,
      role: row.role,
      updatedAt: row.updatedAt,
    }))
}
