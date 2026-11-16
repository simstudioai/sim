import type { ResourceKeyResolver, ResourceKind } from '@sim/workflow-code'
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
 */

/** The `(kind, id)` and `(kind, key)` pairs a canonicalize pass asks a resolver about. */
export interface ResourceReferences {
  ids: ResourceIdRef[]
  keys: ResourceKeyRef[]
}

interface LoadResourceKeyResolverOptions {
  /** Attribution for keys allocated by this load; `null` for an actorless caller. */
  createdBy?: string | null
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
  options: LoadResourceKeyResolverOptions = {}
): Promise<ResourceKeyResolver> {
  const [keysById, idsByKey] = await Promise.all([
    resolveKeys(workspaceId, references.ids ?? [], { createdBy: options.createdBy ?? null }),
    resolveIds(workspaceId, references.keys ?? []),
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
