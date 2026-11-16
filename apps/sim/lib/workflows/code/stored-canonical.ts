/**
 * One canonicalize of a stored workflow per source get or apply.
 *
 * Canonicalize is the dominant per-request cost after the catalog. Two facts let a request reuse
 * one result instead of re-running it:
 *
 * - Resource keys. Canonicalize asks the resolver only about the resources the graph references,
 *   so a resolver that has resolved a superset of those references gives the same result as one
 *   that resolved exactly them. The references a workflow made last time are remembered, resolved
 *   up front through the workspace's bindings, and checked after the pass; only a workflow that
 *   gained a reference pays a second pass.
 * - The lock. Canonicalize reads a lock only for branch keys, by row id
 *   (`CanonicalizeOptions.lock`: it never changes block keys). When every key the lock supplies
 *   for a row equals the key the lockless pass gave that row, the lock changes nothing.
 */
import {
  type BlockCatalog,
  type BranchKey,
  type CanonicalizeResult,
  type CanonicalWorkflowMeta,
  canonicalize,
  type LockIdentity,
  type ResourceKeyResolver,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { LRUCache } from 'lru-cache'
import { loadResourceKeyResolver, type ResourceReferences } from '@/lib/workflows/code/resources'

/**
 * Resources each workflow's stored graph referenced on its last canonicalize: a hint for which
 * bindings to resolve before the pass. A stale entry costs at most resolving a resource no longer
 * referenced (idempotent: it reads or allocates that resource's own key) or one extra pass (a
 * resource newly referenced), never a wrong result. Entries are a handful of ids, so the ceiling
 * is a memory backstop.
 */
const referencesByWorkflow = new LRUCache<string, ResourceReferences>({ max: 20_000 })

interface StoredCanonicalInput {
  workflowId: string
  workspaceId: string
  state: WorkflowState
  meta: CanonicalWorkflowMeta
  catalog: BlockCatalog
  /** Attribution for resource keys allocated by this read; `null` for an actorless caller. */
  createdBy: string | null
}

export interface StoredCanonical {
  /** The lockless canonical model of the stored graph, resource ids lifted to keys. */
  canonical: CanonicalizeResult
  /** Answers every reference in `loaded` from this workspace's bindings. */
  resources: ResourceKeyResolver
  /** The references `resources` has resolved: every one the stored graph makes, maybe more. */
  loaded: ResourceReferences
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
 * the workspace's persisted bindings (`resolveKeys` / `resolveIds`), allocated on first reference.
 */
export async function canonicalizeStored(input: StoredCanonicalInput): Promise<StoredCanonical> {
  const { workflowId, workspaceId, state, meta, catalog, createdBy } = input
  let loaded: ResourceReferences = referencesByWorkflow.get(workflowId) ?? { ids: [], keys: [] }
  let resources = await loadResourceKeyResolver(workspaceId, loaded, { createdBy })
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
      return { canonical, resources, loaded }
    }
    loaded = unionReferences(loaded, missing)
    resources = await loadResourceKeyResolver(workspaceId, loaded, { createdBy })
  }
}

/**
 * Whether canonicalizing with `lock` gives exactly `lockless` (the same state canonicalized with
 * no lock). The lock's branch keys are read by block id then row id, the later entry for an id
 * winning, as canonicalize reads them. A row the lock keys must already have that key; a row it
 * does not key keeps its lockless key, because the keys the lock pre-assigns are other rows' own
 * lockless keys and so never displace one.
 */
export function lockKeepsCanonical(
  lock: Pick<WorkflowLockV1, 'blocks'> | null | undefined,
  lockless: LockIdentity
): boolean {
  const lockKeysById = new Map<string, Map<string, BranchKey>>()
  for (const entry of Object.values(lock?.blocks ?? {})) {
    if (!entry.branches) continue
    const byRow = new Map<string, BranchKey>()
    for (const [key, rowId] of Object.entries(entry.branches)) byRow.set(rowId, key)
    lockKeysById.set(entry.id, byRow)
  }
  if (lockKeysById.size === 0) return true
  for (const block of Object.values(lockless.blocks)) {
    const byRow = block.branches ? lockKeysById.get(block.id) : undefined
    if (!byRow || !block.branches) continue
    for (const [key, rowId] of Object.entries(block.branches)) {
      const locked = byRow.get(rowId)
      if (locked !== undefined && locked !== key) return false
    }
  }
  return true
}

/**
 * `state` canonicalized with `lock`, reusing `lockless` (the same state, catalog, meta and
 * resources with no lock) when the lock changes nothing.
 */
export function canonicalizeUnderLock(
  state: WorkflowState,
  options: { catalog: BlockCatalog; meta: CanonicalWorkflowMeta; resources: ResourceKeyResolver },
  lockless: CanonicalizeResult,
  lock: WorkflowLockV1
): CanonicalizeResult {
  if (lockKeepsCanonical(lock, lockless.identity)) return lockless
  return canonicalize(state, { ...options, lock })
}
