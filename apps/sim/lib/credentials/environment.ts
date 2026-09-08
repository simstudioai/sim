import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  credentialMember,
  permissions,
  user,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { isManagedCredentialGroupBindingLive } from '@/lib/credential-groups/credentials'
import type { DbOrTx } from '@/lib/db/types'
import {
  getEffectiveWorkspacePermission,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'

const ENV_CREDENTIAL_WRITE_CHUNK_SIZE = 500

export interface WorkspaceMembership {
  ownerId: string | null
  /** All workspace members: the owner plus everyone with a workspace permission. */
  memberUserIds: string[]
}

/**
 * Resolves a workspace's membership in one owner lookup + one permissions scan.
 * Credential-admin status is derived from workspace role at access time, so
 * members are seeded only for use access (the owner plus permission holders).
 */
async function getWorkspaceMembership(
  workspaceId: string,
  executor: DbOrTx = db
): Promise<WorkspaceMembership> {
  const workspaceRows = await executor
    .select({ ownerId: workspace.ownerId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  const permissionRows = await executor
    .select({ userId: permissions.userId })
    .from(permissions)
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

  const ownerId = workspaceRows[0]?.ownerId ?? null
  const memberUserIds = new Set<string>(permissionRows.map((row) => row.userId))
  if (ownerId) {
    memberUserIds.add(ownerId)
  }

  return { ownerId, memberUserIds: Array.from(memberUserIds) }
}

export interface CredentialCreationWorkspaceContext extends WorkspaceMembership {
  organizationId: string | null
  canWrite: boolean
}

/**
 * Resolves every workspace fact used by credential creation through the
 * caller's transaction. The route invokes this once to discover the
 * organization lock scope and again after acquiring the shared organization /
 * user locks; only the second result authorizes the insert and seeds
 * credential memberships.
 */
export async function getCredentialCreationWorkspaceContext(params: {
  executor: DbOrTx
  workspaceId: string
  userId: string
  forUpdate?: boolean
}): Promise<CredentialCreationWorkspaceContext | null> {
  const workspaceQuery = params.executor
    .select({
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(and(eq(workspace.id, params.workspaceId), isNull(workspace.archivedAt)))
  /** `FOR NO KEY UPDATE`: see the module header of `lib/billing/storage/tracking.ts`. */
  const [workspaceRow] = params.forUpdate
    ? await workspaceQuery.for('no key update').limit(1)
    : await workspaceQuery.limit(1)
  if (!workspaceRow) return null

  const permissionRows = await params.executor
    .select({ userId: permissions.userId })
    .from(permissions)
    .where(
      and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, params.workspaceId))
    )

  const effectivePermission = await getEffectiveWorkspacePermission(
    params.userId,
    { id: params.workspaceId, organizationId: workspaceRow.organizationId },
    params.executor
  )

  const memberUserIds = new Set(permissionRows.map((row) => row.userId))
  memberUserIds.add(workspaceRow.ownerId)

  return {
    ownerId: workspaceRow.ownerId,
    organizationId: workspaceRow.organizationId,
    memberUserIds: [...memberUserIds],
    canWrite: permissionSatisfies(effectivePermission, 'write'),
  }
}

export interface WorkspaceEnvKeyAdminAccess {
  /** Keys for which the caller is an active credential admin. */
  adminKeys: Set<string>
  /** Keys that already have an `env_workspace` credential (regardless of role). */
  knownKeys: Set<string>
}

export interface PersonalEnvKeyRawAccess {
  /** Keys stored in the caller's own personal Secrets catalog. */
  ownedKeys: Set<string>
  /** Keys owned by someone else for which the caller is an active credential admin. */
  adminKeys: Set<string>
}

/** Resolves which personal secret values a workspace viewer may read as plaintext. */
export async function getPersonalEnvKeyRawAccess(params: {
  workspaceId: string
  personalOwners: Record<string, string>
  userId: string
}): Promise<PersonalEnvKeyRawAccess> {
  const keys = Object.keys(params.personalOwners)
  if (keys.length === 0) return { ownedKeys: new Set(), adminKeys: new Set() }

  const ownedKeys = new Set(
    keys.filter((envKey) => params.personalOwners[envKey] === params.userId)
  )
  const sharedKeys = keys.filter((envKey) => !ownedKeys.has(envKey))
  if (sharedKeys.length === 0) return { ownedKeys, adminKeys: new Set() }

  const credentialRows = await db
    .select({
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      role: credentialMember.role,
      status: credentialMember.status,
    })
    .from(credential)
    .leftJoin(
      credentialMember,
      and(
        eq(credentialMember.credentialId, credential.id),
        eq(credentialMember.userId, params.userId)
      )
    )
    .where(
      and(
        eq(credential.workspaceId, params.workspaceId),
        eq(credential.type, 'env_personal'),
        inArray(credential.envKey, sharedKeys)
      )
    )

  const adminKeys = new Set<string>()
  for (const row of credentialRows) {
    if (
      row.envKey &&
      row.envOwnerUserId === params.personalOwners[row.envKey] &&
      row.envOwnerUserId !== params.userId &&
      row.role === 'admin' &&
      row.status === 'active'
    ) {
      adminKeys.add(row.envKey)
    }
  }

  return { ownedKeys, adminKeys }
}

/**
 * Whether the workspace holds a value under this env key, read from the authoritative
 * `workspace_environment.variables` map.
 *
 * Deliberately NOT {@link getWorkspaceEnvKeyAdminAccess}'s `knownKeys`, which answers the
 * narrower "does an `env_workspace` credential row exist". A legacy value written before the
 * credential ACL existed has no such row yet still wins at run time, so a gate that reads
 * `knownKeys` as "there is no workspace secret here" would let a non-admin through on exactly
 * the keys that predate the ACL. Callers deciding whether a NAME belongs to the workspace must
 * ask this; callers deciding who may administer an ACL keep asking `knownKeys`.
 */
export async function hasWorkspaceEnvValue(params: {
  workspaceId: string
  envKey: string
}): Promise<boolean> {
  const [row] = await db
    .select({ variables: workspaceEnvironment.variables })
    .from(workspaceEnvironment)
    .where(eq(workspaceEnvironment.workspaceId, params.workspaceId))
    .limit(1)

  const variables = row?.variables
  if (!variables || typeof variables !== 'object') return false
  return Object.hasOwn(variables as Record<string, unknown>, params.envKey)
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
  /** Always null on `env_personal`: a mirror row cannot own a user-global secret's note. */
  description: string | null
  /** Always false on `env_personal`: only workspace secrets can opt out of redaction. */
  unredacted: boolean
  updatedAt: Date
}

export async function getUserWorkspaceIds(
  userId: string,
  executor: DbOrTx = db
): Promise<string[]> {
  const permissionRows = await executor
    .select({ workspaceId: workspace.id })
    .from(permissions)
    .innerJoin(
      workspace,
      and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspace.id))
    )
    .where(and(eq(permissions.userId, userId), isNull(workspace.archivedAt)))
  const ownedWorkspaceRows = await executor
    .select({ workspaceId: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.archivedAt)))

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
  executor: DbOrTx = db
) {
  if (!memberUserIds.length) return

  const existingMemberships = await executor
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
    role: 'member' as const,
    status: 'active' as const,
    joinedAt: now,
    invitedBy,
    createdAt: now,
    updatedAt: now,
  }))

  // Existing roles (including manual per-secret overrides) are preserved on
  // conflict; only membership activeness and a missing joinedAt are reconciled.
  await executor
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
  const { ownerId, memberUserIds } = await getWorkspaceMembership(workspaceId)

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
    await ensureWorkspaceCredentialMemberships(credentialId, memberUserIds, ownerId)
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
  updatedAt?: Date
  executor?: DbOrTx
}): Promise<void> {
  const { workspaceId, newKeys, actingUserId } = params
  const executor = params.executor ?? db
  const keys = Array.from(new Set(newKeys.filter(Boolean)))
  if (keys.length === 0) return

  const { ownerId, memberUserIds } = await getWorkspaceMembership(workspaceId, executor)

  if (!ownerId) return

  const now = params.updatedAt ?? new Date()

  const credentialValues = keys.map((envKey) => ({
    id: generateId(),
    workspaceId,
    type: 'env_workspace' as const,
    displayName: envKey,
    envKey,
    createdBy: actingUserId,
    createdAt: now,
    updatedAt: now,
  }))
  const createdIds: string[] = []
  for (const values of chunkArray(credentialValues, ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
    const inserted = await executor
      .insert(credential)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: credential.id })
    createdIds.push(...inserted.map((row) => row.id))
  }

  if (createdIds.length === 0 || memberUserIds.length === 0) return

  /**
   * Chunked because the row count is keys × members and neither side is
   * bounded: a wide enough save exceeds Postgres's 65535 bind parameters and
   * throws. Unchunked that was a partial success — the value was already
   * committed — but this now runs inside the value's transaction, so it would
   * roll the save back, deterministically, on every retry.
   */
  const membershipValues = createdIds.flatMap((credentialId) =>
    memberUserIds.map((memberUserId) => ({
      id: generateId(),
      credentialId,
      userId: memberUserId,
      role: (memberUserId === actingUserId ? 'admin' : 'member') as 'admin' | 'member',
      status: 'active' as const,
      joinedAt: now,
      invitedBy: actingUserId,
      createdAt: now,
      updatedAt: now,
    }))
  )

  for (const values of chunkArray(membershipValues, ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
    await executor.insert(credentialMember).values(values).onConflictDoNothing()
  }
}

/**
 * Deletes credential records (and their memberships via cascade) for removed workspace env keys.
 * Use this instead of `syncWorkspaceEnvCredentials` when the caller knows exactly which keys were deleted.
 */
export async function deleteWorkspaceEnvCredentials(params: {
  workspaceId: string
  removedKeys: string[]
  executor?: DbOrTx
}): Promise<void> {
  const { workspaceId, removedKeys } = params
  const executor = params.executor ?? db
  const keys = removedKeys.filter(Boolean)
  if (keys.length === 0) return

  await executor
    .delete(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'env_workspace'),
        inArray(credential.envKey, keys)
      )
    )
}

/**
 * Ensures one caller-owned personal secret has a credential row in every
 * workspace the caller currently belongs to. Unlike the full catalog sync,
 * this targeted write cannot delete metadata for a concurrently added secret.
 */
export async function upsertPersonalEnvCredentialForUser(params: {
  userId: string
  envKey: string
  updatedAt: Date
  executor?: DbOrTx
}): Promise<void> {
  const { userId, envKey, updatedAt } = params

  const upsert = async (tx: DbOrTx) => {
    await acquireUserBillingIdentityLock(tx, userId)
    const workspaceIds = (await getUserWorkspaceIds(userId, tx)).sort()
    if (workspaceIds.length === 0) return

    const credentialValues = workspaceIds.map((workspaceId) => ({
      id: generateId(),
      workspaceId,
      type: 'env_personal' as const,
      displayName: envKey,
      envKey,
      envOwnerUserId: userId,
      createdBy: userId,
      createdAt: updatedAt,
      updatedAt,
    }))
    for (const values of chunkArray(credentialValues, ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
      await tx.insert(credential).values(values).onConflictDoNothing()
    }

    const currentCredentials = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          inArray(credential.workspaceId, workspaceIds),
          eq(credential.type, 'env_personal'),
          eq(credential.envOwnerUserId, userId),
          eq(credential.envKey, envKey)
        )
      )

    await tx
      .update(credential)
      .set({ updatedAt })
      .where(
        and(
          inArray(credential.workspaceId, workspaceIds),
          eq(credential.type, 'env_personal'),
          eq(credential.envOwnerUserId, userId),
          eq(credential.envKey, envKey)
        )
      )

    if (currentCredentials.length === 0) return

    const membershipValues = currentCredentials.map(({ id: credentialId }) => ({
      id: generateId(),
      credentialId,
      userId,
      role: 'admin' as const,
      status: 'active' as const,
      joinedAt: updatedAt,
      invitedBy: userId,
      createdAt: updatedAt,
      updatedAt,
    }))
    for (const values of chunkArray(membershipValues, ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
      await tx
        .insert(credentialMember)
        .values(values)
        .onConflictDoUpdate({
          target: [credentialMember.credentialId, credentialMember.userId],
          set: { role: 'admin', status: 'active', updatedAt },
        })
    }
  }

  if (params.executor) {
    await upsert(params.executor)
    return
  }
  await db.transaction(upsert)
}

export interface PersonalEnvCredentialMetadata {
  id: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Reads one caller-owned personal secret's credential metadata without scoping to
 * a workspace.
 *
 * A personal secret is stored once per user; the `env_personal` credential rows
 * are per-workspace mirrors, so a reader that needs the secret's own timestamps
 * must not require a mirror in one particular workspace. The earliest mirror is
 * the authoritative creation time — later ones are written when the caller joins
 * another workspace, long after the secret itself was created.
 */
export async function getPersonalEnvCredentialMetadata(params: {
  userId: string
  envKey: string
}): Promise<PersonalEnvCredentialMetadata | null> {
  const [row] = await db
    .select({
      id: credential.id,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    })
    .from(credential)
    .where(
      and(
        eq(credential.type, 'env_personal'),
        eq(credential.envOwnerUserId, params.userId),
        eq(credential.envKey, params.envKey)
      )
    )
    .orderBy(asc(credential.createdAt))
    .limit(1)

  return row ?? null
}

/**
 * Deletes one caller-owned personal secret's credential metadata in every workspace.
 *
 * Deliberately unscoped by workspace: the value being removed alongside it lives
 * in the user-global `environment` row, so leaving mirrors behind in other
 * workspaces would advertise a secret that no longer exists.
 */
export async function deletePersonalEnvCredentialForUser(params: {
  userId: string
  envKey: string
  executor?: DbOrTx
}): Promise<void> {
  const { userId, envKey } = params

  const remove = async (tx: DbOrTx) => {
    await acquireUserBillingIdentityLock(tx, userId)
    await tx
      .delete(credential)
      .where(
        and(
          eq(credential.type, 'env_personal'),
          eq(credential.envOwnerUserId, userId),
          eq(credential.envKey, envKey)
        )
      )
  }

  if (params.executor) {
    await remove(params.executor)
    return
  }
  await db.transaction(remove)
}

export async function syncPersonalEnvCredentialsForUser(params: {
  userId: string
  envKeys: string[]
}): Promise<void> {
  const { userId, envKeys } = params
  const normalizedKeys = Array.from(new Set(envKeys.filter(Boolean)))
  const now = new Date()

  await db.transaction(async (tx) => {
    /**
     * Cross-organization transfer takes this same user-identity fence before
     * checking source-owned credentials. If this sync wins, transfer observes
     * the new env_personal rows and blocks; if transfer wins, this post-lock
     * workspace re-read cannot recreate credentials in the departed org.
     */
    await acquireUserBillingIdentityLock(tx, userId)
    const workspaceIds = (await getUserWorkspaceIds(userId, tx)).sort()

    if (workspaceIds.length === 0) return

    if (normalizedKeys.length > 0) {
      const credentialValues = workspaceIds.flatMap((workspaceId) =>
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
      for (const values of chunkArray(credentialValues, ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
        await tx.insert(credential).values(values).onConflictDoNothing()
      }

      const currentCredentials = await tx
        .select({ id: credential.id })
        .from(credential)
        .where(
          and(
            inArray(credential.workspaceId, workspaceIds),
            eq(credential.type, 'env_personal'),
            eq(credential.envOwnerUserId, userId),
            inArray(credential.envKey, normalizedKeys)
          )
        )

      if (currentCredentials.length > 0) {
        const membershipValues = currentCredentials.map(({ id: credentialId }) => ({
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
        for (const values of chunkArray(membershipValues, ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
          await tx
            .insert(credentialMember)
            .values(values)
            .onConflictDoUpdate({
              target: [credentialMember.credentialId, credentialMember.userId],
              set: { role: 'admin', status: 'active', updatedAt: now },
            })
        }
      }

      await tx
        .delete(credential)
        .where(
          and(
            inArray(credential.workspaceId, workspaceIds),
            eq(credential.type, 'env_personal'),
            eq(credential.envOwnerUserId, userId),
            notInArray(credential.envKey, normalizedKeys)
          )
        )
      return
    }

    await tx
      .delete(credential)
      .where(
        and(
          inArray(credential.workspaceId, workspaceIds),
          eq(credential.type, 'env_personal'),
          eq(credential.envOwnerUserId, userId)
        )
      )
  })
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
      description: credential.description,
      unredacted: credential.unredacted,
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
      description: row.type === 'env_workspace' ? row.description : null,
      unredacted: row.type === 'env_workspace' ? row.unredacted : false,
      updatedAt: row.updatedAt,
    }))
}

export interface AccessibleOAuthCredential {
  id: string
  providerId: string
  displayName: string
  role: 'admin' | 'member'
  /**
   * A personal OAuth connection, a shared service account, or a Credential
   * Group credential the person collected under their own enrollment.
   */
  type: 'oauth' | 'service_account' | 'managed_oauth'
  updatedAt: Date
}

/**
 * The Credential Group credentials a verified person holds through their own
 * enrollments in the workspace and may use right now: the credential, its
 * enrollment, its option, and its group are all live, the same bar every mint
 * applies. These are theirs to use as themselves; the policy's actor statement
 * is what a use is authorized against, so nothing here widens access, it only
 * tells the person (and the agent acting for them) what exists.
 */
export async function getEnrolledManagedOAuthCredentials(
  workspaceId: string,
  userId: string,
  credentialId?: string
): Promise<(AccessibleOAuthCredential & { connectedAt: Date })[]> {
  const query = db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
      credentialGroupOptionId: credential.credentialGroupOptionId,
      managedOauthStatus: credential.managedOauthStatus,
      enrollmentStatus: credentialGroupEnrollment.status,
      groupName: credentialGroup.name,
      groupStatus: credentialGroup.status,
      groupOptions: credentialGroup.options,
      updatedAt: credential.updatedAt,
      grantedAt: credential.grantedAt,
      createdAt: credential.createdAt,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(user, eq(user.id, credentialGroupEnrollment.userId))
    .innerJoin(workspace, eq(workspace.id, workspaceId))
    .where(
      and(
        or(
          and(
            eq(credential.workspaceId, workspaceId),
            eq(credentialGroup.workspaceId, workspaceId)
          ),
          and(
            eq(credential.organizationId, workspace.organizationId),
            eq(credentialGroup.organizationId, workspace.organizationId)
          )
        ),
        eq(credential.createdBy, userId),
        eq(credential.type, 'managed_oauth'),
        credentialId === undefined ? undefined : eq(credential.id, credentialId),
        eq(user.id, userId),
        eq(user.emailVerified, true)
      )
    )
  const rows = await (credentialId === undefined ? query : query.limit(1))

  return rows
    .filter(
      (row): row is typeof row & { providerId: string } =>
        Boolean(row.providerId) &&
        row.managedOauthStatus !== null &&
        isManagedCredentialGroupBindingLive({
          managedOauthStatus: row.managedOauthStatus,
          enrollmentStatus: row.enrollmentStatus,
          groupStatus: row.groupStatus,
          optionStatus:
            row.groupOptions.find((option) => option.id === row.credentialGroupOptionId)?.status ??
            null,
        })
    )
    .map((row) => ({
      id: row.id,
      providerId: row.providerId,
      displayName: `${row.displayName} (${row.groupName})`,
      role: 'member' as const,
      type: 'managed_oauth' as const,
      updatedAt: row.updatedAt,
      connectedAt: row.grantedAt ?? row.createdAt,
    }))
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
        type: credential.type,
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
        type: row.type as AccessibleOAuthCredential['type'],
        updatedAt: row.updatedAt,
      }))
  }

  const rows = await db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
      role: credentialMember.role,
      type: credential.type,
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
      type: row.type as AccessibleOAuthCredential['type'],
      updatedAt: row.updatedAt,
    }))
}
