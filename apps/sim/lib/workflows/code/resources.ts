import type { ResourceKeyResolver, ResourceKind } from '@sim/workflow-code'
import {
  type ResourceIdRef,
  type ResourceKeyMap,
  type ResourceKeyRef,
  resolveIds,
  resolveKeys,
} from '@/lib/workspaces/resource-bindings'

/**
 * Resource keys for workflow source: `table('leads')`, `kb('docs')`, `binding('support-slack')`.
 *
 * Keys come only from the workspace's persisted bindings (`@/lib/workspaces/resource-bindings`),
 * never from a resource's current name: a rename keeps the key, and deleting a resource leaves its
 * key bound to the dead id, so the key is unresolved rather than re-pointed. A stored id that is
 * deleted, archived, of a kind with no workspace table, or from another workspace resolves to
 * `null`, which canonicalize keeps verbatim as `$sim: 'unresolved'`; a key with no live binding
 * resolves to `null`, which materialize reports as `E_MAT_UNKNOWN_RESOURCE`.
 */

/** The `(kind, id)` and `(kind, key)` pairs a pass asked a resolver about. */
interface ResourceReferences {
  ids: ResourceIdRef[]
  keys: ResourceKeyRef[]
}

/**
 * A resolver that answers nothing and records every `(kind, id)` and `(kind, key)` it was asked
 * about, so a first canonicalize pass learns which resources a workflow references before any
 * binding is read or allocated.
 */
export function createRecordingResolver(): {
  resolver: ResourceKeyResolver
  references: ResourceReferences
} {
  const references: ResourceReferences = { ids: [], keys: [] }
  return {
    references,
    resolver: {
      toKey(kind, id) {
        references.ids.push({ kind, id })
        return null
      },
      toId(kind, key) {
        references.keys.push({ kind, key })
        return null
      },
    },
  }
}

interface LoadResourceKeyResolverOptions {
  /** Attribution for keys allocated by this load; `null` for an actorless caller. */
  createdBy?: string | null
}

/**
 * Resolves `references` in one workspace through its bindings and returns a resolver over the
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
