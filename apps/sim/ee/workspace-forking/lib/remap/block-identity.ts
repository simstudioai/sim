import { createHash } from 'node:crypto'

/**
 * Fixed namespace UUID for fork block-identity derivation. Changing this value
 * would re-key every forked workflow's block ids, breaking webhook URLs and
 * external block references (table workflow groups, chat output configs) across
 * promotes - so it must never change.
 */
const FORK_BLOCK_NAMESPACE = '6f1c0e2a-9b3d-5e47-8a1c-2d4f6b8e0c13'

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

/**
 * Deterministic UUIDv5 (SHA-1) of `name` within `namespace`. The same inputs
 * always yield the same UUID, which is how fork block identity stays stable.
 *
 * SHA-1 is mandated by RFC 4122 for UUIDv5 and is used here only for deterministic id derivation,
 * never for secrecy or integrity — not a security use of the algorithm. Swapping it would change
 * every derived id, breaking webhook URLs and stored block-id references across existing forks
 * (see {@link FORK_BLOCK_NAMESPACE}).
 */
function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
  hash.update(uuidToBytes(namespace)) // lgtm[js/weak-cryptographic-algorithm]
  hash.update(Buffer.from(name, 'utf8')) // lgtm[js/weak-cryptographic-algorithm]
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Derive the target block id for a source block copied into a target workflow.
 *
 * Identity is deterministic in `(targetWorkflowId, sourceBlockId)`, so a logical
 * block keeps the same target id across every promote. This is what keeps trigger
 * webhook URLs consistent and keeps external block-id references (table workflow
 * groups, chat output configs, sim_trigger_state) valid across promotes. A source
 * block that no longer exists simply has no derived target, so the target block
 * disappears on the next force-replace.
 */
export function deriveForkBlockId(targetWorkflowId: string, sourceBlockId: string): string {
  return uuidV5(`${targetWorkflowId}:${sourceBlockId}`, FORK_BLOCK_NAMESPACE)
}

/** A persisted counterpart: the target block id plus the workflow it belongs to. */
export interface ForkBlockMapEntry {
  targetBlockId: string
  /** The target-side workflow the pair belongs to (childWorkflowId for parentToChild). */
  targetWorkflowId: string
}

/** Persisted block-identity pairs for an edge, indexed for both promote directions. */
export interface ForkBlockMap {
  /** parent block id -> { child block, child workflow } (pull/create resolve source=parent). */
  parentToChild: ReadonlyMap<string, ForkBlockMapEntry>
  /** child block id -> { parent block, parent workflow } (push resolves source=child). */
  childToParent: ReadonlyMap<string, ForkBlockMapEntry>
}

/** An empty map - fork creation has no prior pairs, so every block id is derived fresh. */
export const EMPTY_FORK_BLOCK_MAP: ForkBlockMap = {
  parentToChild: new Map(),
  childToParent: new Map(),
}

/** Resolve a source block to its target block id for a promote (map-or-derive). */
export type ForkBlockIdResolver = (targetWorkflowId: string, sourceBlockId: string) => string

/**
 * Build the block-id resolver a promote uses to assign target block ids. It reuses the
 * persisted counterpart when one exists AND that pair belongs to the workflow being written,
 * else falls back to {@link deriveForkBlockId} (blocks added since the last sync; fork
 * creation, which has no map). `sourceIsParent` is true on pull/create (source = parent) and
 * false on push (source = child); it selects the lookup direction.
 *
 * The workflow guard is what makes a re-created target safe: if the original target workflow
 * was archived and the promote creates a new one, the recorded pair points at the OLD
 * workflow, so it no longer matches and we derive a fresh id - never reusing the archived
 * workflow's block id (which would collide on the global `workflow_blocks` primary key).
 *
 * For a stable workflow this still maps each child block back to the parent's ORIGINAL id on
 * push, keeping its trigger webhook URL fixed. The SAME resolver must back
 * `copyWorkflowStateIntoTarget` (which writes the blocks) and `collectForkDependentReconfigs`
 * (which keys the modal's override by target block id), or the two would disagree.
 */
export function buildForkBlockIdResolver(
  sourceIsParent: boolean,
  map: ForkBlockMap
): ForkBlockIdResolver {
  const existing = sourceIsParent ? map.parentToChild : map.childToParent
  return (targetWorkflowId, sourceBlockId) => {
    const entry = existing.get(sourceBlockId)
    if (entry && entry.targetWorkflowId === targetWorkflowId) return entry.targetBlockId
    return deriveForkBlockId(targetWorkflowId, sourceBlockId)
  }
}
