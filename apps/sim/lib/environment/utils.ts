import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { lockPersonalEnvMap, lockWorkspaceEnvMap } from '@/lib/credentials/env-locks'
import {
  createWorkspaceEnvCredentials,
  getAccessibleEnvCredentials,
  getWorkspaceEnvKeyAdminAccess,
  syncPersonalEnvCredentialsForUser,
} from '@/lib/credentials/environment'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  type WorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('EnvironmentUtils')
const EFFECTIVE_ENVIRONMENT_CACHE_TTL_MS = 2_000
const EFFECTIVE_ENVIRONMENT_CACHE_MAX_ENTRIES = 1_000

type WorkspaceEnvDenialReason = 'not-secret-admin' | 'write-access-required'

/** Mirrors the messages the workspace environment route returns for the same denials. */
const WORKSPACE_ENV_DENIAL_MESSAGES: Record<WorkspaceEnvDenialReason, string> = {
  'not-secret-admin': 'You must be an admin of these secrets to edit them',
  'write-access-required': 'Write access is required to add new secrets',
}

/** Thrown when the acting user may not write one of the requested env keys. */
export class WorkspaceEnvAccessError extends Error {
  constructor(
    readonly reason: WorkspaceEnvDenialReason,
    readonly keys: string[]
  ) {
    super(WORKSPACE_ENV_DENIAL_MESSAGES[reason])
    this.name = 'WorkspaceEnvAccessError'
  }
}

export interface EnvironmentResolutionSnapshot {
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  personalOwners: Record<string, string>
  conflicts: string[]
  decryptionFailures: string[]
  /**
   * Workspace env keys whose credential row opts them out of resolved-secret redaction.
   * Only ever workspace keys — personal secrets cannot carry the flag — and only keys
   * with a credential row: a legacy jsonb key without one stays redacted by omission.
   */
  workspaceUnredactedKeys: string[]
}

interface EffectiveEnvironmentCacheEntry {
  userId: string
  workspaceId?: string
  promise: Promise<EnvironmentResolutionSnapshot>
}

const effectiveEnvironmentCache = new LRUCache<string, EffectiveEnvironmentCacheEntry>({
  max: EFFECTIVE_ENVIRONMENT_CACHE_MAX_ENTRIES,
  ttl: EFFECTIVE_ENVIRONMENT_CACHE_TTL_MS,
})

function getEffectiveEnvironmentCacheKey(userId: string, workspaceId?: string): string {
  return JSON.stringify([userId, workspaceId ?? null])
}

function cloneEnvironmentResolutionSnapshot(
  snapshot: EnvironmentResolutionSnapshot
): EnvironmentResolutionSnapshot {
  return {
    personalEncrypted: { ...snapshot.personalEncrypted },
    workspaceEncrypted: { ...snapshot.workspaceEncrypted },
    personalDecrypted: { ...snapshot.personalDecrypted },
    workspaceDecrypted: { ...snapshot.workspaceDecrypted },
    personalOwners: { ...snapshot.personalOwners },
    conflicts: [...snapshot.conflicts],
    decryptionFailures: [...snapshot.decryptionFailures],
    workspaceUnredactedKeys: [...snapshot.workspaceUnredactedKeys],
  }
}

export function invalidateEffectiveDecryptedEnvCache(input: {
  userId?: string
  workspaceId?: string
}): void {
  const { userId, workspaceId } = input
  if (!userId && !workspaceId) return

  effectiveEnvironmentCache.forEach((entry, cacheKey) => {
    if (userId && entry.userId === userId) {
      effectiveEnvironmentCache.delete(cacheKey)
      return
    }
    if (workspaceId && entry.workspaceId === workspaceId) {
      effectiveEnvironmentCache.delete(cacheKey)
    }
  })
}

/**
 * Get environment variable keys for a user
 * Returns only the variable names, not their values
 */
export async function getEnvironmentVariableKeys(userId: string): Promise<{
  variableNames: string[]
  count: number
}> {
  try {
    const result = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return {
        variableNames: [],
        count: 0,
      }
    }

    // Get the keys (variable names) without decrypting values
    const encryptedVariables = result[0].variables as Record<string, string>
    const variableNames = Object.keys(encryptedVariables)

    return {
      variableNames,
      count: variableNames.length,
    }
  } catch (error) {
    logger.error('Error getting environment variable keys:', error)
    throw new Error('Failed to get environment variables')
  }
}

interface AccessibleEncryptedEnvironment {
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalOwners: Record<string, string>
  workspaceUnredactedKeys: string[]
}

/**
 * Loads only the encrypted environment slices the caller may use.
 *
 * Keeping this before decryption gives name-only consumers the exact same workspace,
 * credential, shared-personal precedence, and stored-value checks as runtime resolution
 * without exposing plaintext or touching the decrypted snapshot cache.
 */
async function loadAccessibleEncryptedEnvironment(
  userId: string,
  workspaceId?: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<AccessibleEncryptedEnvironment> {
  let workspaceCanAdmin = false
  if (workspaceId) {
    const access = options?.workspaceAccess ?? (await checkWorkspaceAccess(workspaceId, userId))
    if (!access.hasAccess) {
      throw new Error(`Access denied to workspace ${workspaceId}`)
    }
    workspaceCanAdmin = access.canAdmin
  }

  const [personalRows, workspaceRows, accessibleEnvCredentials] = await Promise.all([
    db.select().from(environment).where(eq(environment.userId, userId)).limit(1),
    workspaceId
      ? db
          .select()
          .from(workspaceEnvironment)
          .where(eq(workspaceEnvironment.workspaceId, workspaceId))
          .limit(1)
      : Promise.resolve([] as any[]),
    workspaceId
      ? getAccessibleEnvCredentials(workspaceId, userId, { isWorkspaceAdmin: workspaceCanAdmin })
      : Promise.resolve([]),
  ])

  const ownPersonalEncrypted: Record<string, string> = (personalRows[0]?.variables as any) || {}
  const allWorkspaceEncrypted: Record<string, string> = (workspaceRows[0]?.variables as any) || {}

  const hasCredentialFiltering = Boolean(workspaceId)
  const workspaceCredentialKeys = new Set(
    accessibleEnvCredentials.filter((row) => row.type === 'env_workspace').map((row) => row.envKey)
  )

  const personalCredentialRows = accessibleEnvCredentials
    .filter((row) => row.type === 'env_personal' && row.envOwnerUserId)
    .sort((a, b) => {
      const aIsRequester = a.envOwnerUserId === userId
      const bIsRequester = b.envOwnerUserId === userId
      if (aIsRequester && !bIsRequester) return -1
      if (!aIsRequester && bIsRequester) return 1
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })

  const selectedPersonalOwners = new Map<string, string>()
  for (const row of personalCredentialRows) {
    if (!selectedPersonalOwners.has(row.envKey) && row.envOwnerUserId) {
      selectedPersonalOwners.set(row.envKey, row.envOwnerUserId)
    }
  }

  const ownerUserIds = Array.from(new Set(selectedPersonalOwners.values()))
  const ownerEnvironmentRows =
    ownerUserIds.length > 0
      ? await db
          .select({
            userId: environment.userId,
            variables: environment.variables,
          })
          .from(environment)
          .where(inArray(environment.userId, ownerUserIds))
      : []

  const ownerVariablesByUserId = new Map<string, Record<string, string>>(
    ownerEnvironmentRows.map((row) => [row.userId, (row.variables as Record<string, string>) || {}])
  )

  let personalEncrypted: Record<string, string> = ownPersonalEncrypted
  let workspaceEncrypted: Record<string, string> = allWorkspaceEncrypted
  const personalOwners: Record<string, string> = Object.fromEntries(
    Object.keys(ownPersonalEncrypted).map((envKey) => [envKey, userId])
  )

  if (hasCredentialFiltering) {
    personalEncrypted = { ...ownPersonalEncrypted }
    for (const [envKey, ownerUserId] of selectedPersonalOwners.entries()) {
      const ownerVariables = ownerVariablesByUserId.get(ownerUserId)
      const encryptedValue = ownerVariables?.[envKey]
      if (encryptedValue) {
        personalEncrypted[envKey] = encryptedValue
        personalOwners[envKey] = ownerUserId
      }
    }

    workspaceEncrypted = workspaceCanAdmin
      ? { ...allWorkspaceEncrypted }
      : Object.fromEntries(
          Object.entries(allWorkspaceEncrypted).filter(([envKey]) =>
            workspaceCredentialKeys.has(envKey)
          )
        )
  }

  return {
    personalEncrypted,
    workspaceEncrypted,
    personalOwners,
    workspaceUnredactedKeys: accessibleEnvCredentials
      .filter((row) => row.type === 'env_workspace' && row.unredacted)
      .map((row) => row.envKey),
  }
}

/**
 * Lists the effective environment names visible to a caller without decrypting values.
 * This deliberately performs a fresh ACL-aware encrypted lookup instead of populating or
 * reading the short-lived decrypted environment snapshot cache.
 */
export async function getEffectiveEnvironmentVariableNames(
  userId: string,
  workspaceId?: string
): Promise<string[]> {
  const { personalEncrypted, workspaceEncrypted } = await loadAccessibleEncryptedEnvironment(
    userId,
    workspaceId
  )
  return [
    ...new Set([...Object.keys(personalEncrypted), ...Object.keys(workspaceEncrypted)]),
  ].sort()
}

export async function getPersonalAndWorkspaceEnv(
  userId: string,
  workspaceId?: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<EnvironmentResolutionSnapshot> {
  const { personalEncrypted, workspaceEncrypted, personalOwners, workspaceUnredactedKeys } =
    await loadAccessibleEncryptedEnvironment(userId, workspaceId, options)

  const decryptionFailures: string[] = []

  const decryptAll = async (src: Record<string, string>, source: 'personal' | 'workspace') => {
    const entries = Object.entries(src)
    const results = await Promise.all(
      entries.map(async ([k, v]) => {
        try {
          const { decrypted } = await decryptSecret(v)
          return [k, decrypted] as const
        } catch {
          logger.error('Failed to decrypt environment variable', {
            userId,
            workspaceId,
            source,
          })
          decryptionFailures.push(k)
          return [k, ''] as const
        }
      })
    )
    return Object.fromEntries(results)
  }

  const [personalDecrypted, workspaceDecrypted] = await Promise.all([
    decryptAll(personalEncrypted, 'personal'),
    decryptAll(workspaceEncrypted, 'workspace'),
  ])

  const conflicts = Object.keys(personalEncrypted).filter((k) => k in workspaceEncrypted)

  if (decryptionFailures.length > 0) {
    logger.warn('Some environment variables failed to decrypt', {
      userId,
      workspaceId,
      failedCount: decryptionFailures.length,
    })
  }

  return {
    personalEncrypted,
    workspaceEncrypted,
    personalDecrypted,
    workspaceDecrypted,
    personalOwners,
    conflicts,
    decryptionFailures,
    workspaceUnredactedKeys,
  }
}

/**
 * Resolves one execution's environment from two independent identities.
 *
 * Workspace variables authorize against the execution actor, so the
 * credential-membership filter in {@link getPersonalAndWorkspaceEnv} is applied
 * to whoever caused the run rather than to whoever happens to own the workflow.
 * Personal variables keep the identity that owns them — the session user on an
 * interactive run, the workflow owner on a background one — because a deployed
 * workflow is routinely authored against its owner's personal keys and would
 * otherwise lose them the moment anyone else triggered it.
 *
 * An undefined `personalUserId` means no personal namespace belongs in this run at
 * all, which is how an anonymous public-API call resolves: workspace variables only.
 *
 * A run whose two identities coincide, which is every interactive run, resolves
 * exactly as before through a single query.
 *
 * When the actor has no access to the workspace at all, the personal identity is
 * reused for both slices and the fault is reported rather than raised.
 * `workspace.billedAccountUserId` is a stored column rather than a derivation,
 * so an organization ownership transfer can leave it pointing at a user with no
 * remaining access; failing here would take down every background execution in
 * that workspace for a misconfiguration the run itself did not cause. The error
 * line is what makes that state visible while it is repaired.
 *
 * That fallback is gated on the access decision alone, never on a failed query.
 * Widening to a `catch` would let a transient database fault silently promote the
 * run to the owner's broader secret selection, which is the opposite of what an
 * infrastructure error should do — those propagate and fail the run.
 */
export async function getExecutionEnvironment(
  personalUserId: string | undefined,
  workspaceUserId: string,
  workspaceId?: string
): Promise<EnvironmentResolutionSnapshot> {
  if (personalUserId === undefined) {
    const workspaceOnly = await getPersonalAndWorkspaceEnv(workspaceUserId, workspaceId)
    return {
      ...workspaceOnly,
      personalEncrypted: {},
      personalDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: workspaceOnly.decryptionFailures.filter(
        (key) => key in workspaceOnly.workspaceEncrypted
      ),
    }
  }

  if (!workspaceId || workspaceUserId === personalUserId) {
    return getPersonalAndWorkspaceEnv(personalUserId, workspaceId)
  }

  const actorAccess = await checkWorkspaceAccess(workspaceId, workspaceUserId)
  if (!actorAccess.hasAccess) {
    logger.error('Execution actor cannot reach the workspace; falling back to the owner', {
      personalUserId,
      workspaceUserId,
      workspaceId,
    })
    return getPersonalAndWorkspaceEnv(personalUserId, workspaceId)
  }

  const [personal, actor] = await Promise.all([
    getPersonalAndWorkspaceEnv(personalUserId, workspaceId),
    getPersonalAndWorkspaceEnv(workspaceUserId, workspaceId, { workspaceAccess: actorAccess }),
  ])

  /**
   * Each snapshot reports decryption failures across both of its own slices, so
   * a name is only carried over when it belongs to the slice being kept.
   */
  const decryptionFailures = [
    ...new Set([
      ...personal.decryptionFailures.filter((key) => key in personal.personalEncrypted),
      ...actor.decryptionFailures.filter((key) => key in actor.workspaceEncrypted),
    ]),
  ]

  return {
    personalEncrypted: personal.personalEncrypted,
    workspaceEncrypted: actor.workspaceEncrypted,
    personalDecrypted: personal.personalDecrypted,
    workspaceDecrypted: actor.workspaceDecrypted,
    personalOwners: personal.personalOwners,
    conflicts: Object.keys(personal.personalEncrypted).filter(
      (key) => key in actor.workspaceEncrypted
    ),
    decryptionFailures,
    workspaceUnredactedKeys: actor.workspaceUnredactedKeys,
  }
}

export interface EnvUpsertResult {
  added: string[]
  updated: string[]
}

/**
 * Encrypts and upserts personal environment variables, merging with existing.
 * Only overwrites keys whose decrypted value has actually changed.
 */
export async function upsertPersonalEnvVars(
  userId: string,
  newVars: Record<string, string>
): Promise<EnvUpsertResult> {
  const added: string[] = []
  const updated: string[] = []
  if (Object.keys(newVars).length === 0) return { added, updated }

  const existingData = await db
    .select()
    .from(environment)
    .where(eq(environment.userId, userId))
    .limit(1)
  const existingEncrypted = (existingData[0]?.variables as Record<string, string>) || {}

  const toEncrypt: Record<string, string> = {}
  for (const [key, newVal] of Object.entries(newVars)) {
    if (!(key in existingEncrypted)) {
      toEncrypt[key] = newVal
      added.push(key)
    } else {
      try {
        const { decrypted } = await decryptSecret(existingEncrypted[key])
        if (decrypted !== newVal) {
          toEncrypt[key] = newVal
          updated.push(key)
        }
      } catch {
        toEncrypt[key] = newVal
        updated.push(key)
      }
    }
  }

  const newlyEncrypted: Record<string, string> = {}
  for (const [key, val] of Object.entries(toEncrypt)) {
    const { encrypted } = await encryptSecret(val)
    newlyEncrypted[key] = encrypted
  }

  /**
   * The read above only decides which values changed; the merge has to be made
   * against a read taken under the lock, or a key written concurrently is
   * absent from this map and dropped by the write-back.
   *
   * One consequence worth naming: a key whose submitted value already matched
   * the earlier read is not re-encrypted, so a value written concurrently for
   * that key now survives instead of being overwritten with the identical
   * plaintext. `added`/`updated` describe the earlier read and are reporting
   * only — the keys actually written are exactly the re-encrypted ones.
   */
  const finalEncrypted = await db.transaction(async (tx) => {
    await lockPersonalEnvMap(tx, userId)

    const [currentRow] = await tx
      .select({ variables: environment.variables })
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)
    const current = (currentRow?.variables as Record<string, string>) || {}
    const merged = { ...current, ...newlyEncrypted }

    await tx
      .insert(environment)
      .values({
        id: generateId(),
        userId,
        variables: merged,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [environment.userId],
        set: { variables: merged, updatedAt: new Date() },
      })

    return merged
  })

  invalidateEffectiveDecryptedEnvCache({ userId })
  await syncPersonalEnvCredentialsForUser({
    userId,
    envKeys: Object.keys(finalEncrypted),
  })

  return { added, updated }
}

/**
 * Encrypts and upserts workspace environment variables, merging with existing.
 */
export async function upsertWorkspaceEnvVars(
  workspaceId: string,
  newVars: Record<string, string>,
  actingUserId: string
): Promise<string[]> {
  const updatedKeys = Object.keys(newVars)
  if (updatedKeys.length === 0) return []

  const permission = await getUserEntityPermissions(actingUserId, 'workspace', workspaceId)
  const { adminKeys, knownKeys } = await getWorkspaceEnvKeyAdminAccess({
    workspaceId,
    envKeys: updatedKeys,
    userId: actingUserId,
  })

  // Overwriting an existing secret needs secret-admin on that specific key;
  // workspace `write` alone only covers adding new ones.
  const forbidden = updatedKeys.filter(
    (key) => knownKeys.has(key) && permission !== 'admin' && !adminKeys.has(key)
  )
  if (forbidden.length > 0) {
    logger.warn('Workspace env update denied', {
      workspaceId,
      userId: actingUserId,
      reason: 'not-secret-admin',
      keys: forbidden,
    })
    throw new WorkspaceEnvAccessError('not-secret-admin', forbidden)
  }
  const addingNew = updatedKeys.some((key) => !knownKeys.has(key))
  if (addingNew && permission !== 'admin' && permission !== 'write') {
    logger.warn('Workspace env update denied', {
      workspaceId,
      userId: actingUserId,
      reason: 'write-access-required',
      keys: updatedKeys.filter((key) => !knownKeys.has(key)),
    })
    throw new WorkspaceEnvAccessError(
      'write-access-required',
      updatedKeys.filter((key) => !knownKeys.has(key))
    )
  }

  const newlyEncrypted: Record<string, string> = {}
  for (const [key, val] of Object.entries(newVars)) {
    const { encrypted } = await encryptSecret(val)
    newlyEncrypted[key] = encrypted
  }

  // Read-modify-write on a single jsonb column, so serialize against the
  // route's identically-locked transaction or concurrent writers lose keys.
  await db.transaction(async (tx) => {
    await lockWorkspaceEnvMap(tx, workspaceId)

    const [existingRow] = await tx
      .select()
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1)
    const existing = (existingRow?.variables as Record<string, string>) || {}
    const merged = { ...existing, ...newlyEncrypted }

    await tx
      .insert(workspaceEnvironment)
      .values({
        id: generateId(),
        workspaceId,
        variables: merged,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceEnvironment.workspaceId],
        set: { variables: merged, updatedAt: new Date() },
      })

    // Derived from the stored variables, not from the credential rows: a legacy
    // secret present in the jsonb map without a credential row is NOT new, and
    // minting an ACL for it would make the caller its secret-admin.
    //
    // Written inside this transaction because a value committed without its
    // credential row cannot be repaired by retrying: the key is in the map by
    // then, so the next attempt reads it as pre-existing and creates nothing.
    const newKeys = updatedKeys.filter((key) => !(key in existing))
    await createWorkspaceEnvCredentials({
      workspaceId,
      newKeys,
      actingUserId,
      executor: tx,
    })
  })

  invalidateEffectiveDecryptedEnvCache({ workspaceId })

  recordAudit({
    workspaceId,
    actorId: actingUserId,
    action: AuditAction.ENVIRONMENT_UPDATED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: workspaceId,
    description: `Updated ${updatedKeys.length} workspace environment variable(s)`,
    metadata: { variableCount: updatedKeys.length, updatedKeys },
  })

  return updatedKeys
}

async function getCachedEnvironmentResolutionSnapshot(
  userId: string,
  workspaceId?: string
): Promise<EnvironmentResolutionSnapshot> {
  const cacheKey = getEffectiveEnvironmentCacheKey(userId, workspaceId)
  const cached = effectiveEnvironmentCache.get(cacheKey)
  if (cached) {
    return cached.promise
  }

  const promise = getPersonalAndWorkspaceEnv(userId, workspaceId).catch((error) => {
    effectiveEnvironmentCache.delete(cacheKey)
    throw error
  })

  effectiveEnvironmentCache.set(cacheKey, {
    userId,
    workspaceId,
    promise,
  })

  return promise
}

/**
 * Returns a defensive clone of the cached environment snapshot used for runtime resolution.
 */
export async function getEffectiveEnvironmentSnapshot(
  userId: string,
  workspaceId?: string
): Promise<EnvironmentResolutionSnapshot> {
  return cloneEnvironmentResolutionSnapshot(
    await getCachedEnvironmentResolutionSnapshot(userId, workspaceId)
  )
}

/**
 * Returns a merged decrypted env map for webhook/copilot/MCP config resolution.
 */
export async function getEffectiveDecryptedEnv(
  userId: string,
  workspaceId?: string
): Promise<Record<string, string>> {
  const { personalDecrypted, workspaceDecrypted } = await getCachedEnvironmentResolutionSnapshot(
    userId,
    workspaceId
  )
  return { ...personalDecrypted, ...workspaceDecrypted }
}
