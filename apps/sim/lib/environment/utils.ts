import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { eq, inArray, type SQLWrapper, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
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

type AccessibleEnvCredential = Awaited<ReturnType<typeof getAccessibleEnvCredentials>>[number]

/**
 * Throws unless the caller may read `workspaceId`, and returns whether they administer it. A
 * caller that already resolved the access passes it rather than reading it again.
 */
async function requireEnvWorkspaceAccess(
  workspaceId: string,
  userId: string,
  workspaceAccess?: WorkspaceAccess
): Promise<boolean> {
  const access = workspaceAccess ?? (await checkWorkspaceAccess(workspaceId, userId))
  // A deleted workspace and a forbidden one need different fixes (stop using the id vs ask for
  // access), so they throw distinct errors.
  if (!access.exists) {
    throw new Error(`Workspace ${workspaceId} does not exist`)
  }
  if (!access.hasAccess) {
    throw new Error(`Access denied to workspace ${workspaceId}`)
  }
  return access.canAdmin
}

/**
 * What a caller's env credentials grant in a workspace: the workspace keys they may use (every
 * key for an admin), and for each shared personal key the owner whose stored value it reads (the
 * caller's own first, then the most recently updated share).
 */
function envCredentialGrants(
  rows: readonly AccessibleEnvCredential[],
  userId: string,
  workspaceCanAdmin: boolean
): { usesWorkspaceKey: (envKey: string) => boolean; personalOwners: Map<string, string> } {
  const workspaceCredentialKeys = new Set(
    rows.filter((row) => row.type === 'env_workspace').map((row) => row.envKey)
  )
  const personalCredentialRows = rows
    .filter((row) => row.type === 'env_personal' && row.envOwnerUserId)
    .sort((a, b) => {
      const aIsRequester = a.envOwnerUserId === userId
      const bIsRequester = b.envOwnerUserId === userId
      if (aIsRequester && !bIsRequester) return -1
      if (!aIsRequester && bIsRequester) return 1
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })

  const personalOwners = new Map<string, string>()
  for (const row of personalCredentialRows) {
    if (!personalOwners.has(row.envKey) && row.envOwnerUserId) {
      personalOwners.set(row.envKey, row.envOwnerUserId)
    }
  }
  return {
    usesWorkspaceKey: (envKey) => workspaceCanAdmin || workspaceCredentialKeys.has(envKey),
    personalOwners,
  }
}

/**
 * The one rule for which env entries a caller may use in a workspace, over stored maps: their own
 * personal entries; each shared personal key from the owner {@link envCredentialGrants} selects,
 * when that owner stores a value for it (overriding their own); and the workspace keys the grants
 * allow. `T` is a ciphertext on the values path and a presence marker on the names path, so both
 * paths list exactly the same names. That holds because an owner's stored entry counts when it is
 * non-empty on both paths: the names path drops `''` in SQL (`envNamesOf(…, true)`), and the
 * values path's `if (stored)` drops it here, since a stored value is never empty ciphertext.
 */
function selectGrantedEnvironment<T>(args: {
  userId: string
  own: Readonly<Record<string, T>>
  storedByOwner: ReadonlyMap<string, Readonly<Record<string, T>>>
  workspace: Readonly<Record<string, T>>
  grants: ReturnType<typeof envCredentialGrants>
}): {
  personal: Record<string, T>
  workspace: Record<string, T>
  personalOwners: Record<string, string>
} {
  const personal: Record<string, T> = { ...args.own }
  const personalOwners: Record<string, string> = Object.fromEntries(
    Object.keys(args.own).map((envKey) => [envKey, args.userId])
  )
  for (const [envKey, ownerUserId] of args.grants.personalOwners) {
    const stored = args.storedByOwner.get(ownerUserId)?.[envKey]
    if (stored) {
      personal[envKey] = stored
      personalOwners[envKey] = ownerUserId
    }
  }
  const workspace = Object.fromEntries(
    Object.entries(args.workspace).filter(([envKey]) => args.grants.usesWorkspaceKey(envKey))
  )
  return { personal, workspace, personalOwners }
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
  const workspaceCanAdmin = workspaceId
    ? await requireEnvWorkspaceAccess(workspaceId, userId, options?.workspaceAccess)
    : false

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

  const grants = envCredentialGrants(accessibleEnvCredentials, userId, workspaceCanAdmin)
  const ownerUserIds = Array.from(new Set(grants.personalOwners.values()))
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

  const granted = selectGrantedEnvironment({
    userId,
    own: ownPersonalEncrypted,
    storedByOwner: new Map(
      ownerEnvironmentRows.map((row) => [
        row.userId,
        (row.variables as Record<string, string>) || {},
      ])
    ),
    workspace: allWorkspaceEncrypted,
    grants,
  })
  return {
    personalEncrypted: granted.personal,
    workspaceEncrypted: granted.workspace,
    personalOwners: granted.personalOwners,
    workspaceUnredactedKeys: accessibleEnvCredentials
      .filter((row) => row.type === 'env_workspace' && row.unredacted)
      .map((row) => row.envKey),
  }
}

/** A stored env map's names as a JSON array, so no value leaves the database. */
function envNamesOf(variables: SQLWrapper, storedOnly = false) {
  const stored = storedOnly ? sql` where entry.value <> ''` : sql``
  return sql<
    string[]
  >`coalesce((select json_agg(entry.key) from json_each_text(${variables}) as entry${stored}), '[]')`
}

/**
 * The env names a caller may use in a workspace, reading key names only: the same workspace
 * access, credential grants, and shared-personal stored-value rule as the values path
 * ({@link selectGrantedEnvironment}), with no ciphertext fetched and no decrypted snapshot cached.
 * A caller that already resolved the workspace access passes it.
 */
export async function getWorkspaceEnvironmentVariableNames(
  userId: string,
  workspaceId: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<string[]> {
  const workspaceCanAdmin = await requireEnvWorkspaceAccess(
    workspaceId,
    userId,
    options?.workspaceAccess
  )
  const [personalRows, workspaceRows, accessibleEnvCredentials] = await Promise.all([
    db
      .select({ names: envNamesOf(environment.variables) })
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1),
    db
      .select({ names: envNamesOf(workspaceEnvironment.variables) })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1),
    getAccessibleEnvCredentials(workspaceId, userId, { isWorkspaceAdmin: workspaceCanAdmin }),
  ])
  const grants = envCredentialGrants(accessibleEnvCredentials, userId, workspaceCanAdmin)

  const ownerUserIds = [...new Set(grants.personalOwners.values())]
  const ownerRows =
    ownerUserIds.length > 0
      ? await db
          .select({ userId: environment.userId, names: envNamesOf(environment.variables, true) })
          .from(environment)
          .where(inArray(environment.userId, ownerUserIds))
      : []

  const granted = selectGrantedEnvironment({
    userId,
    own: presenceOf(personalRows[0]?.names),
    storedByOwner: new Map(ownerRows.map((row) => [row.userId, presenceOf(row.names)])),
    workspace: presenceOf(workspaceRows[0]?.names),
    grants,
  })
  return [...new Set([...Object.keys(granted.personal), ...Object.keys(granted.workspace)])].sort(
    compareStrings
  )
}

/** Names as a presence map, the names path's stand-in for a stored value. */
function presenceOf(names: readonly string[] | undefined): Record<string, true> {
  return Object.fromEntries((names ?? []).map((name) => [name, true as const]))
}

export interface ResolvedEnvironmentVariable {
  value: string
  scope: 'personal' | 'workspace'
  visible: boolean
}

/**
 * Resolves only the requested environment variables through a fresh ACL-aware lookup.
 *
 * This deliberately neither reads nor populates the runtime environment snapshot cache.
 * Workspace values take precedence over personal values, matching normal resolution. Missing,
 * inaccessible, and undecryptable values are all omitted so callers cannot distinguish them.
 */
export async function resolveEffectiveEnvironmentVariables(
  userId: string,
  workspaceId: string | undefined,
  requestedNames: readonly string[]
): Promise<Record<string, ResolvedEnvironmentVariable>> {
  const names = [...new Set(requestedNames)]
  if (names.length === 0) return {}

  const { personalEncrypted, workspaceEncrypted, personalOwners, workspaceUnredactedKeys } =
    await loadAccessibleEncryptedEnvironment(userId, workspaceId)
  const visibleWorkspaceNames = new Set(workspaceUnredactedKeys)

  const resolvedEntries = await Promise.all(
    names.map(async (name) => {
      const fromWorkspace = Object.hasOwn(workspaceEncrypted, name)
      const fromPersonal = Object.hasOwn(personalEncrypted, name)
      const encrypted = fromWorkspace
        ? workspaceEncrypted[name]
        : fromPersonal
          ? personalEncrypted[name]
          : undefined
      if (encrypted === undefined) return null

      try {
        const { decrypted } = await decryptSecret(encrypted)
        return [
          name,
          {
            value: decrypted,
            scope: fromWorkspace ? 'workspace' : 'personal',
            visible: fromWorkspace
              ? visibleWorkspaceNames.has(name)
              : personalOwners[name] === userId,
          },
        ] as const
      } catch {
        return null
      }
    })
  )

  return Object.fromEntries(
    resolvedEntries.filter(
      (entry): entry is readonly [string, ResolvedEnvironmentVariable] => entry !== null
    )
  )
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
 * Keeps only the workspace slice of a snapshot resolved for a single identity.
 *
 * Used wherever a run has no personal namespace to lend, so the identity that
 * authorized the workspace variables cannot leak its own personal ones in
 * alongside them. `conflicts` is empty by construction once the personal slice
 * is, and a decryption failure is only carried over when it belongs to the slice
 * being kept.
 */
function toWorkspaceOnlySnapshot(
  snapshot: EnvironmentResolutionSnapshot
): EnvironmentResolutionSnapshot {
  return {
    ...snapshot,
    personalEncrypted: {},
    personalDecrypted: {},
    personalOwners: {},
    conflicts: [],
    decryptionFailures: snapshot.decryptionFailures.filter(
      (key) => key in snapshot.workspaceEncrypted
    ),
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
 * Neither identity is a permission the run holds — both are stored pointers that
 * outlive the access that made them valid, so a stale one is reported rather than
 * raised. `workspace.billedAccountUserId` is a stored column rather than a
 * derivation, so an ownership transfer can leave the actor pointing at a user with
 * no remaining access; `workflow.userId` is likewise a stored pointer that
 * member-removal repairs on the paths it knows about. Failing on either would take
 * down every background execution in the workspace for a misconfiguration the run
 * itself did not cause. The error lines are what make that state visible while it
 * is repaired.
 *
 * The two stale cases degrade differently because the identities mean different
 * things. An actor that cannot reach the workspace leaves the owner as the only
 * identity to authorize the workspace slice against, so the run falls back to
 * resolving both slices as the owner. A personal identity that cannot reach the
 * workspace is no longer someone whose private namespace it is reasonable to lend
 * — the same judgment already applied to an anonymous public-API call — so the run
 * keeps the actor's workspace slice and resolves no personal variables at all.
 * Continuing to lend a removed member's personal secrets to their former
 * organization's background runs is the outcome to avoid, not the one to preserve.
 * A reference to a variable that is no longer resolvable survives as its literal
 * `{{NAME}}` and fails at the block that needs it, which names the missing
 * variable instead of failing the run before any block has started.
 *
 * With no reachable identity on either side there is nobody to authorize the
 * workspace slice against, and a filtered selection cannot be computed, so that
 * case still raises.
 *
 * These fallbacks are gated on the access decision alone, never on a failed query.
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
    return toWorkspaceOnlySnapshot(await getPersonalAndWorkspaceEnv(workspaceUserId, workspaceId))
  }

  /**
   * A suspended account lends nothing, from any path.
   *
   * Applied on every path, including the single-identity shortcut below, because
   * "the caller already cleared this identity" does not hold everywhere: a
   * custom-block child is admitted by `admitCustomBlockChildExecution`, which checks
   * usage limits and nothing else, and a provider URL-validation challenge resolves
   * with no admission at all. Behind the shortcut, a publisher who is also their
   * workspace's billing account made both identities equal and skipped the gate
   * entirely — the one arrangement where suspension was silently ignored.
   *
   * Only the personal namespace is withheld. Workspace variables belong to the
   * workspace rather than to a person, so they keep resolving and the runs a
   * suspended member's teammates depend on keep working — which is the whole
   * reason admission stopped blocking on this identity in the first place.
   *
   * The lookup depends on nothing the reads below produce, so it runs alongside
   * them, and a suspended identity's personal slice is dropped from their result.
   * The one exception is two distinct identities with no workspace: the personal
   * read there is not needed once suspension is known, so it waits for the answer.
   */
  const personalIdentitySuspended = getActivelyBannedUserIds([personalUserId]).then(
    (bannedUserIds) => bannedUserIds.length > 0
  )
  const withholdPersonalSlice = (snapshot: EnvironmentResolutionSnapshot) => {
    logger.error('Personal-environment identity is suspended; resolving workspace variables only', {
      personalUserId,
      workspaceUserId,
      workspaceId,
    })
    return toWorkspaceOnlySnapshot(snapshot)
  }

  if (workspaceUserId === personalUserId) {
    const [suspended, snapshot] = await Promise.all([
      personalIdentitySuspended,
      getPersonalAndWorkspaceEnv(personalUserId, workspaceId),
    ])
    return suspended ? withholdPersonalSlice(snapshot) : snapshot
  }

  if (!workspaceId) {
    if (await personalIdentitySuspended) {
      return withholdPersonalSlice(await getPersonalAndWorkspaceEnv(workspaceUserId, workspaceId))
    }
    return getPersonalAndWorkspaceEnv(personalUserId, workspaceId)
  }

  const personalAccessRead = checkWorkspaceAccess(workspaceId, personalUserId)
  personalAccessRead.catch(() => {})
  const [suspended, actorAccess] = await Promise.all([
    personalIdentitySuspended,
    checkWorkspaceAccess(workspaceId, workspaceUserId),
  ])
  // A suspended identity's access is never consulted, so its read cannot fail the run.
  if (suspended) {
    return withholdPersonalSlice(
      await getPersonalAndWorkspaceEnv(workspaceUserId, workspaceId, {
        workspaceAccess: actorAccess,
      })
    )
  }
  const personalAccess = await personalAccessRead

  /**
   * A workspace that no longer exists and one an identity may not read are
   * different facts, exactly as in {@link getPersonalAndWorkspaceEnv}. Only the
   * second is a stale pointer worth degrading for.
   */
  if (!personalAccess.exists) {
    throw new Error(`Workspace ${workspaceId} does not exist`)
  }

  if (!personalAccess.hasAccess) {
    if (!actorAccess.hasAccess) {
      logger.error('Neither execution identity can reach the workspace', {
        personalUserId,
        workspaceUserId,
        workspaceId,
      })
      throw new Error(`Access denied to workspace ${workspaceId}`)
    }

    logger.error(
      'Personal-environment identity cannot reach the workspace; resolving workspace variables only',
      { personalUserId, workspaceUserId, workspaceId }
    )
    return toWorkspaceOnlySnapshot(
      await getPersonalAndWorkspaceEnv(workspaceUserId, workspaceId, {
        workspaceAccess: actorAccess,
      })
    )
  }

  if (!actorAccess.hasAccess) {
    logger.error('Execution actor cannot reach the workspace; falling back to the owner', {
      personalUserId,
      workspaceUserId,
      workspaceId,
    })
    return getPersonalAndWorkspaceEnv(personalUserId, workspaceId, {
      workspaceAccess: personalAccess,
    })
  }

  const [personal, actor] = await Promise.all([
    getPersonalAndWorkspaceEnv(personalUserId, workspaceId, { workspaceAccess: personalAccess }),
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
  await db.transaction(async (tx) => {
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
  })

  invalidateEffectiveDecryptedEnvCache({ userId })
  await syncPersonalEnvCredentialsForUser({
    userId,
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
