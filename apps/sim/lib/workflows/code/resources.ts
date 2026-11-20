import { db } from '@sim/db'
import { credential, credentialMember, skill } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import type { ResourceKeyResolver, ResourceKind } from '@sim/workflow-code'
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { SHARED_CREDENTIAL_TYPES } from '@/lib/credentials/access'
import { credentialAccessClause, credentialMembershipJoin } from '@/lib/credentials/queries'
import { getWorkspaceEnvironmentVariableNames } from '@/lib/environment/utils'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { checkWorkspaceAccess, type WorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import {
  listLiveKeys,
  type ResourceIdRef,
  type ResourceKeyMap,
  type ResourceKeyRef,
  resolveIds,
  resolveKeys,
} from '@/lib/workspaces/resource-keys'

/**
 * Resource keys for workflow source: `table('leads')`, `knowledgeBase('docs')`,
 * `credential('support-slack')`.
 *
 * Keys come only from the workspace's persisted resource keys (`@/lib/workspaces/resource-keys`),
 * never from a resource's current name: a rename keeps the key, and deleting a resource leaves its
 * key bound to the dead id, so the key is unresolved rather than re-pointed. A stored id that is
 * deleted, archived, of a kind with no workspace table, or from another workspace resolves to
 * `null`, which canonicalize keeps verbatim as `$sim: 'unresolved'`; a key with no live resource
 * resolves to `null`, which materialize reports as `E_MAT_UNKNOWN_RESOURCE`.
 *
 * A credential's key is derived from its display name, so a saved credential the caller cannot
 * see (see `loadVisibleCredentials`) resolves in neither direction for them: its id stays
 * `unresolved` (printed verbatim, so an unchanged re-apply keeps the binding), no key is allocated
 * from its name, and naming its key is an unknown resource, as for one that does not exist.
 */

/** Env-secret credential types, which a `credential(...)` never names. */
const ENV_CREDENTIAL_TYPES = ['env_workspace', 'env_personal'] as const

interface VisibleCredentialQuery {
  /** Most rows returned, oldest first. */
  limit: number
  /** Only these ids, when given. */
  ids?: string[]
  /** The caller's workspace access, when already resolved. */
  access?: WorkspaceAccess
}

/**
 * The saved credentials (never env secrets) the caller may see, by the credential listing's own
 * access rule: a user sees what they are a member of, their own personal tokens and, as a
 * workspace admin, every shared credential. A caller with no human subject (a workspace API key)
 * sees the shared credentials only, never anyone's personal ones.
 */
export async function loadVisibleCredentials(
  workspaceId: string,
  userId: string | undefined,
  query: VisibleCredentialQuery
) {
  const columns = {
    id: credential.id,
    name: credential.displayName,
    type: credential.type,
    providerId: credential.providerId,
  }
  const scope = and(
    eq(credential.workspaceId, workspaceId),
    notInArray(credential.type, [...ENV_CREDENTIAL_TYPES]),
    query.ids ? inArray(credential.id, query.ids) : undefined
  )
  const order = [asc(credential.createdAt), asc(credential.id)]
  if (!userId) {
    return db
      .select(columns)
      .from(credential)
      .where(and(scope, inArray(credential.type, SHARED_CREDENTIAL_TYPES)))
      .orderBy(...order)
      .limit(query.limit)
  }
  const access = query.access ?? (await checkWorkspaceAccess(workspaceId, userId))
  return db
    .select(columns)
    .from(credential)
    .leftJoin(credentialMember, credentialMembershipJoin(userId))
    .where(and(scope, credentialAccessClause(userId, access.canAdmin)))
    .orderBy(...order)
    .limit(query.limit)
}

/** The saved credentials among `ids` that `userId` cannot see; env credentials are never hidden. */
async function hiddenCredentialIds(
  workspaceId: string,
  userId: string | undefined,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const [saved, visible] = await Promise.all([
    db
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          inArray(credential.id, ids),
          notInArray(credential.type, [...ENV_CREDENTIAL_TYPES])
        )
      ),
    loadVisibleCredentials(workspaceId, userId, { ids, limit: ids.length }),
  ])
  const visibleIds = new Set(visible.map((row) => row.id))
  return new Set(saved.flatMap((row) => (visibleIds.has(row.id) ? [] : [row.id])))
}

/**
 * Current names of the skills among `ids` in the workspace: a stored skill entry carries the
 * skill's name beside its id (`{ skillId, name }`), which materialize fills for a newly named skill.
 */
async function loadSkillNames(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: skill.id, name: skill.name })
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, ids)))
  return new Map(rows.map((row) => [row.id, row.name]))
}

const credentialIdsOf = (refs: ResourceIdRef[]) =>
  refs.flatMap((ref) => (ref.kind === 'credential' ? [ref.id] : []))

/** The `(kind, id)` and `(kind, key)` pairs a canonicalize pass asks a resolver about. */
export interface ResourceReferences {
  ids: ResourceIdRef[]
  keys: ResourceKeyRef[]
}

interface LoadResourceKeyResolverOptions {
  /**
   * The caller's human subject: attribution for keys allocated by this load, and whose credential
   * access bounds which credentials resolve. `null` for a caller with none (a workspace API key),
   * which sees the shared credentials only.
   */
  actorUserId: string | null
  /** `false` resolves only the keys already bound, allocating none (a plan writes nothing). */
  allocate?: boolean
}

/**
 * Resolves `references` in one workspace through its resource keys and returns a resolver over the
 * result: each referenced live resource's key (allocated on first reference, see `resolveKeys`)
 * and each referenced key's live resource, in both directions (so a fingerprint taken after
 * writing a key's id prints that key). Nothing outside `references` resolves. `nameOf` answers
 * for each resolved skill, and `isBuiltin` for the built-in skills, which have no row to key.
 */
export async function loadResourceKeyResolver(
  workspaceId: string,
  references: Partial<ResourceReferences>,
  options: LoadResourceKeyResolverOptions
): Promise<ResourceKeyResolver> {
  const actorUserId = options.actorUserId ?? undefined
  const idRefs = references.ids ?? []
  const [hiddenRefIds, boundIdsByKey] = await Promise.all([
    hiddenCredentialIds(workspaceId, actorUserId, credentialIdsOf(idRefs)),
    resolveIds(workspaceId, references.keys ?? []),
  ])
  const [keysById, idsByKey] = await Promise.all([
    resolveKeys(
      workspaceId,
      idRefs.filter((ref) => ref.kind !== 'credential' || !hiddenRefIds.has(ref.id)),
      { createdBy: options.actorUserId, allocate: options.allocate }
    ),
    withoutHiddenCredentials(workspaceId, actorUserId, boundIdsByKey),
  ])
  const invert = (map: ResourceKeyMap): ResourceKeyMap =>
    new Map([...map].map(([kind, pairs]) => [kind, new Map([...pairs].map(([a, b]) => [b, a]))]))
  const keysByIdFromKeys = invert(idsByKey)
  const idsByKeyFromIds = invert(keysById)
  const skillIds = new Set([
    ...(keysById.get('skill')?.keys() ?? []),
    ...(idsByKey.get('skill')?.values() ?? []),
  ])
  const skillNames = await loadSkillNames(workspaceId, [...skillIds])
  const lookup = (map: ResourceKeyMap, kind: ResourceKind, value: string) =>
    map.get(kind)?.get(value) ?? null
  return {
    toKey: (kind, id) => lookup(keysById, kind, id) ?? lookup(keysByIdFromKeys, kind, id),
    toId: (kind, key) => lookup(idsByKey, kind, key) ?? lookup(idsByKeyFromIds, kind, key),
    nameOf: (kind, id) => (kind === 'skill' ? (skillNames.get(id) ?? null) : null),
    isBuiltin: (kind, id) => kind === 'skill' && isBuiltinSkillId(id),
  }
}

/** How many keys of one kind an unknown-key finding lists. */
const AVAILABLE_KEYS_LIMIT = 200

/**
 * The keys a source could name for each of `kinds` in the workspace, for an unknown-key finding's
 * did-you-mean and list. A credential the caller cannot see is left out, as everywhere else.
 */
export async function loadAvailableResourceKeys(
  workspaceId: string,
  kinds: readonly ResourceKind[],
  actorUserId: string | null
): Promise<Map<ResourceKind, string[]>> {
  const userId = actorUserId ?? undefined
  const entries = await Promise.all(
    [...new Set(kinds)].map(async (kind) => {
      const rows = await listLiveKeys(workspaceId, kind, { limit: AVAILABLE_KEYS_LIMIT })
      if (kind !== 'credential') return [kind, rows.map((row) => row.key)] as const
      const hidden = await hiddenCredentialIds(
        workspaceId,
        userId,
        rows.map((row) => row.resourceId)
      )
      return [kind, rows.flatMap((row) => (hidden.has(row.resourceId) ? [] : [row.key]))] as const
    })
  )
  return new Map(entries)
}

/** `idsByKey` without the credential keys bound to a credential `userId` cannot see. */
async function withoutHiddenCredentials(
  workspaceId: string,
  userId: string | undefined,
  idsByKey: ResourceKeyMap
): Promise<ResourceKeyMap> {
  const credentials = idsByKey.get('credential')
  if (!credentials) return idsByKey
  const hidden = await hiddenCredentialIds(workspaceId, userId, [...credentials.values()])
  if (hidden.size === 0) return idsByKey
  const visible = new Map([...credentials].filter(([, id]) => !hidden.has(id)))
  const result = new Map(idsByKey)
  if (visible.size > 0) result.set('credential', visible)
  else result.delete('credential')
  return result
}

/**
 * Env names the caller's runs resolve in this workspace, by runtime's own ACL-aware lookup: a
 * workspace secret only when the caller is an admin or an active member of its credential, plus
 * their personal variables and the personal ones shared with them here. With no human subject,
 * the workspace's secrets only, as a run with no caller resolves them for the workspace's billing
 * account. Names only: no secret value is read. `access` is the caller's workspace access, when
 * already resolved.
 */
export async function loadEnvNames(
  workspaceId: string,
  userId: string | undefined,
  access?: WorkspaceAccess
): Promise<string[]> {
  if (userId) {
    return getWorkspaceEnvironmentVariableNames(userId, workspaceId, { workspaceAccess: access })
  }
  const rows = await db
    .select({ envKey: credential.envKey })
    .from(credential)
    .where(and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'env_workspace')))
  const names = new Set(rows.flatMap((row) => (row.envKey ? [row.envKey] : [])))
  return [...names].sort(compareStrings)
}
