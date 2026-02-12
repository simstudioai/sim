import { db } from '@sim/db'
import { credential, credentialMember, permissions, workspace } from '@sim/db/schema'
import { and, eq, inArray, notInArray } from 'drizzle-orm'

interface AccessibleEnvCredential {
  type: 'env_workspace' | 'env_personal'
  envKey: string
  envOwnerUserId: string | null
  updatedAt: Date
}

function getPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const err = error as { code?: string; cause?: { code?: string } }
  return err.code || err.cause?.code
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
      .where(eq(permissions.userId, userId)),
    db.select({ workspaceId: workspace.id }).from(workspace).where(eq(workspace.ownerId, userId)),
  ])

  const workspaceIds = new Set<string>(permissionRows.map((row) => row.workspaceId))
  for (const row of ownedWorkspaceRows) {
    workspaceIds.add(row.workspaceId)
  }

  return Array.from(workspaceIds)
}

async function upsertCredentialAdminMember(credentialId: string, adminUserId: string) {
  const now = new Date()
  const [existingMembership] = await db
    .select({ id: credentialMember.id, joinedAt: credentialMember.joinedAt })
    .from(credentialMember)
    .where(
      and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, adminUserId))
    )
    .limit(1)

  if (existingMembership) {
    await db
      .update(credentialMember)
      .set({
        role: 'admin',
        status: 'active',
        joinedAt: existingMembership.joinedAt ?? now,
        invitedBy: adminUserId,
        updatedAt: now,
      })
      .where(eq(credentialMember.id, existingMembership.id))
    return
  }

  await db.insert(credentialMember).values({
    id: crypto.randomUUID(),
    credentialId,
    userId: adminUserId,
    role: 'admin',
    status: 'active',
    joinedAt: now,
    invitedBy: adminUserId,
    createdAt: now,
    updatedAt: now,
  })
}

async function ensureWorkspaceCredentialMemberships(
  credentialId: string,
  workspaceId: string,
  ownerUserId: string
) {
  const workspaceMemberUserIds = await getWorkspaceMemberUserIds(workspaceId)
  if (!workspaceMemberUserIds.length) return

  const existingMemberships = await db
    .select({
      id: credentialMember.id,
      userId: credentialMember.userId,
      joinedAt: credentialMember.joinedAt,
    })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, credentialId),
        inArray(credentialMember.userId, workspaceMemberUserIds)
      )
    )

  const byUserId = new Map(existingMemberships.map((row) => [row.userId, row]))
  const now = new Date()

  for (const memberUserId of workspaceMemberUserIds) {
    const targetRole = memberUserId === ownerUserId ? 'admin' : 'member'
    const existing = byUserId.get(memberUserId)
    if (existing) {
      await db
        .update(credentialMember)
        .set({
          role: targetRole,
          status: 'active',
          joinedAt: existing.joinedAt ?? now,
          invitedBy: ownerUserId,
          updatedAt: now,
        })
        .where(eq(credentialMember.id, existing.id))
      continue
    }

    await db.insert(credentialMember).values({
      id: crypto.randomUUID(),
      credentialId,
      userId: memberUserId,
      role: targetRole,
      status: 'active',
      joinedAt: now,
      invitedBy: ownerUserId,
      createdAt: now,
      updatedAt: now,
    })
  }
}

export async function syncWorkspaceEnvCredentials(params: {
  workspaceId: string
  envKeys: string[]
  actingUserId: string
}) {
  const { workspaceId, envKeys, actingUserId } = params
  const [workspaceRow] = await db
    .select({ ownerId: workspace.ownerId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

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
    if (existingId) {
      credentialIdsToEnsureMembership.add(existingId)
      continue
    }

    const createdId = crypto.randomUUID()
    try {
      await db.insert(credential).values({
        id: createdId,
        workspaceId,
        type: 'env_workspace',
        displayName: envKey,
        envKey,
        createdBy: actingUserId,
        createdAt: now,
        updatedAt: now,
      })
      credentialIdsToEnsureMembership.add(createdId)
    } catch (error: unknown) {
      const code = getPostgresErrorCode(error)
      if (code !== '23505') throw error
    }
  }

  for (const credentialId of credentialIdsToEnsureMembership) {
    await ensureWorkspaceCredentialMemberships(credentialId, workspaceId, workspaceRow.ownerId)
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

export async function syncPersonalEnvCredentialsForUser(params: {
  userId: string
  envKeys: string[]
}) {
  const { userId, envKeys } = params
  const workspaceIds = await getUserWorkspaceIds(userId)
  if (!workspaceIds.length) return

  const normalizedKeys = Array.from(new Set(envKeys.filter(Boolean)))
  const now = new Date()

  for (const workspaceId of workspaceIds) {
    const existingCredentials = await db
      .select({
        id: credential.id,
        envKey: credential.envKey,
      })
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_personal'),
          eq(credential.envOwnerUserId, userId)
        )
      )

    const existingByKey = new Map(
      existingCredentials
        .filter((row): row is { id: string; envKey: string } => Boolean(row.envKey))
        .map((row) => [row.envKey, row.id])
    )

    for (const envKey of normalizedKeys) {
      const existingId = existingByKey.get(envKey)
      if (existingId) {
        await upsertCredentialAdminMember(existingId, userId)
        continue
      }

      const createdId = crypto.randomUUID()
      try {
        await db.insert(credential).values({
          id: createdId,
          workspaceId,
          type: 'env_personal',
          displayName: envKey,
          envKey,
          envOwnerUserId: userId,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        await upsertCredentialAdminMember(createdId, userId)
      } catch (error: unknown) {
        const code = getPostgresErrorCode(error)
        if (code !== '23505') throw error
      }
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
      continue
    }

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
