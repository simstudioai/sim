/**
 * One canonicalize of a stored workflow per source get or apply.
 *
 * Canonicalize is the dominant per-request cost after the catalog. Two facts let a request reuse
 * one result instead of re-running it:
 *
 * - Resource keys. Canonicalize asks the resolver only about the kinds the graph references, so a
 *   resolver that has loaded a superset of those kinds gives the same result as one that loaded
 *   exactly them. The kinds a workflow asked for last time are remembered, loaded up front, and
 *   checked after the pass; only a workflow that gained a kind pays a second pass.
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
  type ResourceKind,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { LRUCache } from 'lru-cache'
import { loadResourceKeyResolver } from '@/lib/workflows/code/resources'

/**
 * Resource kinds each workflow's stored graph referenced on its last canonicalize: a hint for
 * which resource tables to read before the pass. A stale entry costs at most one extra table read
 * (a kind no longer referenced) or one extra pass (a kind newly referenced), never a wrong result.
 * Entries are a handful of kind names, so the ceiling is a memory backstop.
 */
const referencedKindsByWorkflow = new LRUCache<string, ReadonlySet<ResourceKind>>({
  max: 20_000,
})

interface StoredCanonicalInput {
  workflowId: string
  workspaceId: string
  state: WorkflowState
  meta: CanonicalWorkflowMeta
  catalog: BlockCatalog
}

interface StoredCanonical {
  /** The lockless canonical model of the stored graph, resource ids lifted to keys. */
  canonical: CanonicalizeResult
  /** Answers every kind in `loadedKinds` from this workspace's live resources. */
  resources: ResourceKeyResolver
  /** The kinds `resources` has loaded: every kind the stored graph references, maybe more. */
  loadedKinds: ReadonlySet<ResourceKind>
}

/**
 * Canonicalizes the stored graph with its resource keys, normally in one pass. The result equals
 * a recording pass followed by a pass over a resolver for exactly the recorded kinds.
 */
export async function canonicalizeStored(input: StoredCanonicalInput): Promise<StoredCanonical> {
  const { workflowId, workspaceId, state, meta, catalog } = input
  let loadedKinds: ReadonlySet<ResourceKind> =
    referencedKindsByWorkflow.get(workflowId) ?? new Set()
  let resources = await loadResourceKeyResolver(workspaceId, loadedKinds)
  for (;;) {
    const referenced = new Set<ResourceKind>()
    const canonical = canonicalize(state, {
      catalog,
      meta,
      resources: {
        toKey(kind, id) {
          referenced.add(kind)
          return resources.toKey(kind, id)
        },
        toId(kind, key) {
          referenced.add(kind)
          return resources.toId(kind, key)
        },
      },
    })
    const missing = [...referenced].filter((kind) => !loadedKinds.has(kind))
    if (missing.length === 0) {
      referencedKindsByWorkflow.set(workflowId, referenced)
      return { canonical, resources, loadedKinds }
    }
    loadedKinds = new Set([...loadedKinds, ...missing])
    resources = await loadResourceKeyResolver(workspaceId, loadedKinds)
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
