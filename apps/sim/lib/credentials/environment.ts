import { db } from '@sim/db'
import {
  credential,
  type credentialEnvVisibilityEnum,
  credentialMember,
  permissions,
  workspace,
} from '@sim/db/schema'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import type { DbOrTx } from '@/lib/db/types'
import {
  checkWorkspaceAccess,
  getEffectiveWorkspacePermission,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'

const PERSONAL_ENV_CREDENTIAL_WRITE_CHUNK_SIZE = 500

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
  const [workspaceRows, permissionRows] = await Promise.all([
    executor
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    executor
      .select({ userId: permissions.userId })
      .from(permissions)
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))),
  ])

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
  const [workspaceRow] = params.forUpdate
    ? await workspaceQuery.for('update').limit(1)
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

/** Disclosure policy for an env credential. Mirrors `credentialEnvVisibilityEnum`. */
export type EnvVisibility = (typeof credentialEnvVisibilityEnum.enumValues)[number]

export interface WorkspaceEnvKeyAdminAccess {
  /** Keys for which the caller is an active credential admin. */
  adminKeys: Set<string>
  /** Keys that already have an `env_workspace` credential (regardless of role). */
  knownKeys: Set<string>
  /**
   * Keys marked non-secret. Feeds the read/mask path only — write
   * authorization is identical for secrets and variables, so callers gating
   * writes must not consult this.
   */
  variableKeys: Set<string>
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
  if (keys.length === 0) {
    return { adminKeys: new Set(), knownKeys: new Set(), variableKeys: new Set() }
  }

  const rows = await db
    .select({
      envKey: credential.envKey,
      envVisibility: credential.envVisibility,
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
  const variableKeys = new Set<string>()
  for (const row of rows) {
    if (!row.envKey) continue
    knownKeys.add(row.envKey)
    if (row.role === 'admin' && row.status === 'active') adminKeys.add(row.envKey)
    if (row.envVisibility === 'variable') variableKeys.add(row.envKey)
  }
  return { adminKeys, knownKeys, variableKeys }
}

interface AccessibleEnvCredential {
  type: 'env_workspace' | 'env_personal'
  envKey: string
  envOwnerUserId: string | null
  envVisibility: EnvVisibility
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
  invitedBy: string
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
    role: 'member' as const,
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
  /** Per-key disclosure policy for the new keys. Anything unlisted is a secret. */
  visibilityByKey?: Record<string, EnvVisibility>
  /**
   * Runs the inserts inside a caller-supplied transaction so they roll back with
   * the rest of the request. The env PUT mixes these credential rows with a jsonb
   * value upsert and a visibility change, and a denial in any of them must leave
   * none of the others committed.
   */
  executor?: DbOrTx
}): Promise<void> {
  const { workspaceId, newKeys, actingUserId, visibilityByKey, executor = db } = params
  const keys = Array.from(new Set(newKeys.filter(Boolean)))
  if (keys.length === 0) return

  const { ownerId, memberUserIds } = await getWorkspaceMembership(workspaceId, executor)

  if (!ownerId) return

  const now = new Date()

  const inserted = await executor
    .insert(credential)
    .values(
      keys.map((envKey) => ({
        id: generateId(),
        workspaceId,
        type: 'env_workspace' as const,
        displayName: envKey,
        envKey,
        envVisibility: visibilityByKey?.[envKey] ?? ('secret' as const),
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
      role: (memberUserId === actingUserId ? 'admin' : 'member') as 'admin' | 'member',
      status: 'active' as const,
      joinedAt: now,
      invitedBy: actingUserId,
      createdAt: now,
      updatedAt: now,
    }))
  )

  await executor.insert(credentialMember).values(membershipValues).onConflictDoNothing()
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

/** Thrown when the caller may not change the disclosure policy of a key. */
export class WorkspaceEnvVisibilityAccessError extends Error {
  constructor(readonly keys: string[]) {
    super('You must be an admin of these secrets to change their visibility')
    this.name = 'WorkspaceEnvVisibilityAccessError'
  }
}

/**
 * The single path that changes an env key's disclosure policy.
 *
 * Centralized because flipping `secret -> variable` is a disclosure event that
 * cannot be undone: by the time the flag is reverted the value has plausibly
 * reached trace spans, log rows, agent context, and members' browsers. Both
 * directions therefore take the stricter gate (workspace admin, or credential
 * admin on that specific key) rather than the workspace `write` that suffices
 * for editing a value.
 *
 * A no-op request is authorized trivially — asking for the visibility a key
 * already has reveals nothing and must not 403.
 */
export interface AuthorizedVisibilityChange {
  credentialId: string
  envKey: string
  next: EnvVisibility
}

/**
 * Resolves and AUTHORIZES a visibility change without writing anything.
 *
 * Split from the apply step so a caller can fail a denied request before it
 * commits anything else. The route mixes value writes and visibility changes in
 * one request; running the check afterwards let an allowed new key (and its
 * credential rows) persist while the request still returned 403, leaving state
 * changed by a rejected call and skipping the audit record for it.
 *
 * A no-op request authorizes trivially — asking for the visibility a key
 * already has reveals nothing and must not 403.
 */
async function authorizeWorkspaceEnvVisibilityChange(params: {
  workspaceId: string
  updates: Record<string, EnvVisibility>
  actingUserId: string
  executor?: DbOrTx
}): Promise<AuthorizedVisibilityChange[]> {
  const { workspaceId, updates, actingUserId, executor = db } = params
  const requestedKeys = Object.keys(updates).filter(Boolean)
  if (requestedKeys.length === 0) return []

  const existingRows = await executor
    .select({
      id: credential.id,
      envKey: credential.envKey,
      envVisibility: credential.envVisibility,
    })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'env_workspace'),
        inArray(credential.envKey, requestedKeys)
      )
    )

  const changing = existingRows.filter(
    (row) => row.envKey !== null && updates[row.envKey] !== row.envVisibility
  )
  if (changing.length === 0) return []

  const changingKeys = changing.map((row) => row.envKey as string)

  // Share-lock the rows that grant this caller the right to disclose, BEFORE
  // reading them. A concurrent revocation must either commit before the lock —
  // in which case the reads below observe it and deny — or block until this
  // transaction ends. Without the locks the permission read and the UPDATE are
  // two independent statements, and a revocation landing between them leaves a
  // former admin able to flip a secret to a workspace-visible variable.
  //
  // `executor` is the caller's transaction, which is what makes the locks span
  // the UPDATE. Called without one, each statement is its own implicit
  // transaction and the locks release immediately — harmless, but it is why
  // `setWorkspaceEnvVisibility` is the only supported entry point.
  await executor
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, actingUserId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .for('share')
  await executor
    .select({ id: credentialMember.id })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.userId, actingUserId),
        inArray(
          credentialMember.credentialId,
          changing.map((row) => row.id)
        )
      )
    )
    .for('share')

  const [isWorkspaceAdmin, { adminKeys }] = await Promise.all([
    hasWorkspaceAdminAccess(actingUserId, workspaceId),
    getWorkspaceEnvKeyAdminAccess({ workspaceId, envKeys: changingKeys, userId: actingUserId }),
  ])

  const forbidden = isWorkspaceAdmin ? [] : changingKeys.filter((key) => !adminKeys.has(key))
  if (forbidden.length > 0) {
    throw new WorkspaceEnvVisibilityAccessError(forbidden)
  }

  return changing.map((row) => ({
    credentialId: row.id,
    envKey: row.envKey as string,
    next: updates[row.envKey as string],
  }))
}

/**
 * Applies changes already authorized by
 * {@link authorizeWorkspaceEnvVisibilityChange}. Performs no permission check of
 * its own.
 *
 * Deliberately NOT exported. An authorization decision carried across unrelated
 * awaits goes stale — the caller's credential-admin or workspace-admin access
 * can be revoked in between, and applying by credential ID would then disclose a
 * secret to someone who has just lost the right to disclose it. Keeping this
 * private forces every caller through {@link setWorkspaceEnvVisibility}, which
 * decides and writes adjacently.
 */
async function applyWorkspaceEnvVisibilityChange(params: {
  changes: AuthorizedVisibilityChange[]
  executor?: DbOrTx
}): Promise<{ changedKeys: string[] }> {
  const { changes, executor = db } = params
  if (changes.length === 0) return { changedKeys: [] }

  const now = new Date()
  for (const change of changes) {
    await executor
      .update(credential)
      .set({ envVisibility: change.next, updatedAt: now })
      .where(eq(credential.id, change.credentialId))
  }
  return { changedKeys: changes.map((change) => change.envKey) }
}

/**
 * The single path that changes an env key's disclosure policy.
 *
 * Centralized because flipping `secret -> variable` is a disclosure event that
 * cannot be undone: by the time the flag is reverted the value has plausibly
 * reached trace spans, log rows, agent context, and members' browsers. Both
 * directions therefore take the stricter gate (workspace admin, or credential
 * admin on that specific key) rather than the workspace `write` that suffices
 * for editing a value.
 *
 * Authorizes and applies adjacently, in that order, with no caller able to hold
 * the decision in between — both halves are unexported for exactly that reason.
 *
 * Pass `executor` to run inside the caller's transaction. That is what lets the
 * authorization's share-locks span the UPDATE, and what lets a denial roll back
 * the caller's other writes rather than stranding them.
 */
export async function setWorkspaceEnvVisibility(params: {
  workspaceId: string
  updates: Record<string, EnvVisibility>
  actingUserId: string
  executor?: DbOrTx
}): Promise<{ changedKeys: string[] }> {
  const changes = await authorizeWorkspaceEnvVisibilityChange(params)
  return applyWorkspaceEnvVisibilityChange({ changes, executor: params.executor })
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
      for (const values of chunkArray(credentialValues, PERSONAL_ENV_CREDENTIAL_WRITE_CHUNK_SIZE)) {
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
        for (const values of chunkArray(
          membershipValues,
          PERSONAL_ENV_CREDENTIAL_WRITE_CHUNK_SIZE
        )) {
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
  options?: { isWorkspaceAdmin?: boolean; hasWorkspaceAccess?: boolean }
): Promise<AccessibleEnvCredential[]> {
  // `hasWorkspaceAccess` gates the non-secret bypass below and must never be
  // assumed. Without it the bypass hands a workspace's non-secret keys to ANY
  // caller, including a user with no membership in that workspace — the other
  // three clauses are all scoped to the user, and this one is not. Callers do
  // check access upstream today, but this function's contract is "credentials
  // this user may access", so it enforces that itself rather than trusting
  // every future caller to remember. Verified against live Postgres by
  // `apps/sim/scripts/verify-env-acl.ts`.
  //
  // Resolved from one `checkWorkspaceAccess` unless the caller supplied both
  // facts; an admin trivially has access. A caller without access still sees
  // their own personal credentials via the `envOwnerUserId` clause — only the
  // bypass is withheld.
  const resolvedAccess =
    options?.isWorkspaceAdmin !== undefined && options?.hasWorkspaceAccess !== undefined
      ? undefined
      : await checkWorkspaceAccess(workspaceId, userId)
  const isWorkspaceAdmin = options?.isWorkspaceAdmin ?? resolvedAccess?.canAdmin ?? false
  const hasWorkspaceAccess =
    options?.hasWorkspaceAccess ?? (isWorkspaceAdmin || (resolvedAccess?.hasAccess ?? false))

  const rows = await db
    .select({
      type: credential.type,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      envVisibility: credential.envVisibility,
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
          // Non-secret workspace values are readable by every MEMBER, so they
          // bypass the per-key credential ACL — but only for a caller who
          // actually has workspace access. Unlike the clauses above it, this
          // one is not scoped to the user, so dropping the membership gate
          // would return these keys to anyone who names the workspace.
          //
          // The `env_workspace` predicate is redundant with the schema's
          // `credential_env_visibility_scope_check` and kept anyway, so the
          // query stays correct on its own if that constraint is ever relaxed.
          hasWorkspaceAccess
            ? and(eq(credential.type, 'env_workspace'), eq(credential.envVisibility, 'variable'))
            : undefined,
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
      envVisibility: row.envVisibility,
      updatedAt: row.updatedAt,
    }))
}

export interface AccessibleOAuthCredential {
  id: string
  providerId: string
  displayName: string
  role: 'admin' | 'member'
  /** Distinguishes a personal OAuth connection from a shared service account. */
  type: 'oauth' | 'service_account'
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
