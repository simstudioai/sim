import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import type { ResourceKeyResolver, ResourceKind } from '@sim/workflow-code'
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { SHARED_CREDENTIAL_TYPES } from '@/lib/credentials/access'
import { credentialAccessClause, credentialMembershipJoin } from '@/lib/credentials/queries'
import { getEffectiveEnvironmentVariableNames } from '@/lib/environment/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import {
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

/** Credential types a `credential(...)` can name: every saved account, never an env secret. */
const ENV_CREDENTIAL_TYPES = ['env_workspace', 'env_personal'] as const

interface VisibleCredentialQuery {
  /** Most rows returned, oldest first. */
  limit: number
  /** Only these ids, when given. */
  ids?: string[]
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
  const access = await checkWorkspaceAccess(workspaceId, userId)
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
}

/**
 * Resolves `references` in one workspace through its resource keys and returns a resolver over the
 * result: each referenced live resource's key (allocated on first reference, see `resolveKeys`)
 * and each referenced key's live resource, in both directions (so a fingerprint taken after
 * writing a key's id prints that key). Nothing outside `references` resolves.
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
      { createdBy: options.actorUserId }
    ),
    withoutHiddenCredentials(workspaceId, actorUserId, boundIdsByKey),
  ])
  const invert = (map: ResourceKeyMap): ResourceKeyMap =>
    new Map([...map].map(([kind, pairs]) => [kind, new Map([...pairs].map(([a, b]) => [b, a]))]))
  const keysByIdFromKeys = invert(idsByKey)
  const idsByKeyFromIds = invert(keysById)
  const lookup = (map: ResourceKeyMap, kind: ResourceKind, value: string) =>
    map.get(kind)?.get(value) ?? null
  return {
    toKey: (kind, id) => lookup(keysById, kind, id) ?? lookup(keysByIdFromKeys, kind, id),
    toId: (kind, key) => lookup(idsByKey, kind, key) ?? lookup(idsByKeyFromIds, kind, key),
  }
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
 * account.
 */
export async function loadEnvNames(
  workspaceId: string,
  userId: string | undefined
): Promise<string[]> {
  if (userId) return getEffectiveEnvironmentVariableNames(userId, workspaceId)
  const rows = await db
    .select({ envKey: credential.envKey })
    .from(credential)
    .where(and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'env_workspace')))
  const names = new Set(rows.flatMap((row) => (row.envKey ? [row.envKey] : [])))
  return [...names].sort(compareStrings)
}
