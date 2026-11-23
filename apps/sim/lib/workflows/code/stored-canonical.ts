/**
 * One canonicalize of a stored workflow per source get or apply.
 *
 * Canonicalize is the dominant per-request cost after the catalog. Two facts let a request reuse
 * one result instead of re-running it:
 *
 * - Resource keys. Canonicalize asks the resolver only about the resources the graph references,
 *   so a resolver that has resolved a superset of those references gives the same result as one
 *   that resolved exactly them. The references a workflow made last time are remembered, resolved
 *   up front through the workspace's resource keys, and checked after the pass; only a workflow that
 *   gained a reference pays a second pass.
 * - The lock. Canonicalize reads a lock only for branch keys, by row id (it never changes block
 *   keys), so `canonicalizeUnderLock` reuses the lockless result whenever the lock agrees with it.
 */
import {
  type BlockCatalog,
  type CanonicalizeResult,
  type CanonicalWorkflowMeta,
  canonicalize,
  type ResourceKeyResolver,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { LRUCache } from 'lru-cache'
import { loadResourceKeyResolver, type ResourceReferences } from '@/lib/workflows/code/resources'

/**
 * Resources each workflow's stored graph referenced on its last canonicalize: a hint for which
 * resource keys to resolve before the pass. A stale entry costs at most resolving a resource no longer
 * referenced (idempotent: it reads or allocates that resource's own key) or one extra pass (a
 * resource newly referenced), never a wrong result. Entries are a handful of ids, so the ceiling
 * is a memory backstop.
 */
const referencesByWorkflow = new LRUCache<string, ResourceReferences>({ max: 20_000 })

interface StoredResourceScope {
  workflowId: string
  workspaceId: string
  /**
   * The caller's human subject: attribution for resource keys allocated by this read, and whose
   * credential access bounds which credentials print by key. `null` for an actorless caller.
   */
  createdBy: string | null
  /**
   * `false` resolves only the resource keys already bound, allocating none, so a plan or a
   * fingerprint check writes nothing.
   */
  allocate?: boolean
}

/** The resolver for a workflow's remembered references, loaded before its graph is. */
export interface PrefetchedStoredResources extends StoredResourceScope {
  loaded: ResourceReferences
  resources: ResourceKeyResolver
}

/**
 * Resolves the resource references the workflow's stored graph made last time, which needs no
 * graph: started beside the graph load, it takes the resolver load off the critical path.
 */
export async function prefetchStoredResources(
  scope: StoredResourceScope
): Promise<PrefetchedStoredResources> {
  const loaded = referencesByWorkflow.get(scope.workflowId) ?? { ids: [], keys: [] }
  const resources = await loadResourceKeyResolver(scope.workspaceId, loaded, {
    actorUserId: scope.createdBy,
    allocate: scope.allocate,
  })
  return { ...scope, loaded, resources }
}

/**
 * {@link prefetchStoredResources} for many workflows read together: one resolver for every
 * reference any of them made last time, so each canonicalizes against it with no load of its own
 * (a workflow that gained a reference still loads its own on the second pass).
 */
export async function prefetchStoredResourcesFor(
  scope: Omit<StoredResourceScope, 'workflowId'>,
  workflowIds: readonly string[]
): Promise<Omit<PrefetchedStoredResources, 'workflowId'>> {
  let loaded: ResourceReferences = { ids: [], keys: [] }
  for (const workflowId of workflowIds) {
    const remembered = referencesByWorkflow.get(workflowId)
    if (remembered) loaded = unionReferences(loaded, remembered)
  }
  const resources = await loadResourceKeyResolver(scope.workspaceId, loaded, {
    actorUserId: scope.createdBy,
    allocate: scope.allocate,
  })
  return { ...scope, loaded, resources }
}

interface StoredCanonicalInput {
  prefetched: PrefetchedStoredResources
  state: WorkflowState
  meta: CanonicalWorkflowMeta
  catalog: BlockCatalog
}

/** A stored graph canonicalized against its workspace's resource keys. */
export interface StoredCanonical {
  /** The lockless canonical model of the stored graph, resource ids lifted to keys. */
  canonical: CanonicalizeResult
  /** Answers every reference the stored graph makes from this workspace's resource keys. */
  resources: ResourceKeyResolver
}

const idRefKey = (kind: string, id: string) => `${kind}\u0000${id}`

/** `base` plus each reference in `extra` it lacks, in order, without duplicates. */
function unionReferences(base: ResourceReferences, extra: ResourceReferences): ResourceReferences {
  const ids = new Map(base.ids.map((ref) => [idRefKey(ref.kind, ref.id), ref]))
  const keys = new Map(base.keys.map((ref) => [idRefKey(ref.kind, ref.key), ref]))
  for (const ref of extra.ids) ids.set(idRefKey(ref.kind, ref.id), ref)
  for (const ref of extra.keys) keys.set(idRefKey(ref.kind, ref.key), ref)
  return { ids: [...ids.values()], keys: [...keys.values()] }
}

/**
 * Canonicalizes the stored graph with its resource keys, normally in one pass. The result equals
 * a recording pass followed by a pass over a resolver for exactly the recorded references. This is
 * the single entry point for canonicalizing a stored workflow with resources: keys come only from
 * the workspace's persisted resource keys (`resolveKeys` / `resolveIds`), allocated on first reference
 * unless the prefetch was made with `allocate: false`.
 */
export async function canonicalizeStored(input: StoredCanonicalInput): Promise<StoredCanonical> {
  const { state, meta, catalog } = input
  const { workflowId, workspaceId, createdBy, allocate } = input.prefetched
  let { loaded, resources } = input.prefetched
  for (;;) {
    const referenced: ResourceReferences = { ids: [], keys: [] }
    const current = resources
    const canonical = canonicalize(state, {
      catalog,
      meta,
      resources: {
        toKey(kind, id) {
          referenced.ids.push({ kind, id })
          return current.toKey(kind, id)
        },
        toId(kind, key) {
          referenced.keys.push({ kind, key })
          return current.toId(kind, key)
        },
        isBuiltin: current.isBuiltin,
      },
    })
    const loadedIds = new Set(loaded.ids.map((ref) => idRefKey(ref.kind, ref.id)))
    const loadedKeys = new Set(loaded.keys.map((ref) => idRefKey(ref.kind, ref.key)))
    const missing: ResourceReferences = {
      ids: referenced.ids.filter((ref) => !loadedIds.has(idRefKey(ref.kind, ref.id))),
      keys: referenced.keys.filter((ref) => !loadedKeys.has(idRefKey(ref.kind, ref.key))),
    }
    if (missing.ids.length === 0 && missing.keys.length === 0) {
      referencesByWorkflow.set(workflowId, unionReferences({ ids: [], keys: [] }, referenced))
      return { canonical, resources }
    }
    loaded = unionReferences(loaded, missing)
    resources = await loadResourceKeyResolver(workspaceId, loaded, {
      actorUserId: createdBy,
      allocate,
    })
  }
}
