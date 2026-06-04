import { db } from '@sim/db'
import { credential, credentialMember, permissions, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'

interface AccessibleEnvCredential {
  type: 'env_workspace' | 'env_personal'
  envKey: string
  envOwnerUserId: string | null
  updatedAt: Date
}

export async function getWorkspaceMemberUserIds(workspaceId: string): Promise<string[]> {
  const [workspaceRows, permissionRows] = await Promise.all([
    db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({ userId: permissions.userId })
      .from(permissions)
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))),
  ])
  const workspaceRow = workspaceRows[0]

  const memberIds = new Set<string>(permissionRows.map((row) => row.userId))
  if (workspaceRow?.ownerId) {
    memberIds.add(workspaceRow.ownerId)
  }
  return Array.from(memberIds)
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
  ownerUserId: string
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
    role: (memberUserId === ownerUserId ? 'admin' : 'member') as 'admin' | 'member',
    status: 'active' as const,
    joinedAt: now,
    invitedBy: ownerUserId,
    createdAt: now,
    updatedAt: now,
  }))

  // `joinedAt` uses COALESCE so a non-null existing value is preserved but null is backfilled.
  await db
    .insert(credentialMember)
    .values(values)
    .onConflictDoUpdate({
      target: [credentialMember.credentialId, credentialMember.userId],
      set: {
        role: sql`excluded.role`,
        status: 'active',
        joinedAt: sql`COALESCE(${credentialMember.joinedAt}, excluded.joined_at)`,
        invitedBy: ownerUserId,
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
  const [[workspaceRow], memberUserIds] = await Promise.all([
    db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    getWorkspaceMemberUserIds(workspaceId),
  ])

  if (!workspaceRow) return

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
    await ensureWorkspaceCredentialMemberships(credentialId, memberUserIds, workspaceRow.ownerId)
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

  const [[workspaceRow], memberUserIds] = await Promise.all([
    db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    getWorkspaceMemberUserIds(workspaceId),
  ])

  if (!workspaceRow) return

  const ownerUserId = workspaceRow.ownerId
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
      role: (memberUserId === ownerUserId ? 'admin' : 'member') as 'admin' | 'member',
      status: 'active' as const,
      joinedAt: now,
      invitedBy: ownerUserId,
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
  userId: string
): Promise<AccessibleEnvCredential[]> {
  const rows = await db
    .select({
      type: credential.type,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
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
        inArray(credential.type, ['env_workspace', 'env_personal'])
      )
    )

  return rows
    .filter(
      (row): row is AccessibleEnvCredential =>
        (row.type === 'env_workspace' || row.type === 'env_personal') && Boolean(row.envKey)
    )
    .map((row) => ({
      type: row.type,
      envKey: row.envKey!,
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
  userId: string
): Promise<AccessibleOAuthCredential[]> {
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
