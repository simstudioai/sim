/**
 * `diffCanonical`: a key-based diff of two CWMs, the input to the apply path's source diff summary.
 * Like every CWM comparison it ignores `annotations`, key order and edge order.
 */

import { portKey } from '../anchors'
import type { LockIdentity } from '../lock'
import type {
  BlockKey,
  CanonicalBlock,
  CanonicalEdge,
  CanonicalParamId,
  CanonicalWorkflow,
  CanonicalWorkflowMeta,
  SubBlockId,
  VarKey,
} from '../model'
import { deepEqual } from '../records'

const META_FIELDS: Array<keyof CanonicalWorkflowMeta> = ['name', 'description']

const ATTRIBUTES: Array<Exclude<BlockAttribute, 'parent'>> = [
  'name',
  'type',
  'enabled',
  'locked',
  'triggerMode',
  'advancedMode',
  'errorPort',
  'retry',
  'branches',
  'subflow',
  'extra',
]

function unionKeys(left: object | undefined, right: object | undefined): string[] {
  return [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])]
}

function blockChanges(
  base: CanonicalBlock,
  target: CanonicalBlock,
  baseKeyOf: (targetKey: BlockKey) => BlockKey
): BlockChange[] {
  const changes: BlockChange[] = []
  for (const attribute of ATTRIBUTES) {
    if (!deepEqual(base[attribute], target[attribute])) {
      changes.push({ kind: 'attribute', attribute })
    }
  }
  const targetParent = target.parent === null ? null : baseKeyOf(target.parent)
  if (base.parent !== targetParent) changes.push({ kind: 'attribute', attribute: 'parent' })
  for (const param of unionKeys(base.params, target.params)) {
    if (!deepEqual(base.params[param], target.params[param])) changes.push({ kind: 'param', param })
  }
  for (const canonicalParamId of unionKeys(base.modes, target.modes)) {
    if (base.modes[canonicalParamId] !== target.modes[canonicalParamId]) {
      changes.push({ kind: 'mode', canonicalParamId })
    }
  }
  return changes
}

/** Block-level fields a diff can name, besides params and modes. */
export type BlockAttribute =
  | 'name'
  | 'type'
  | 'parent'
  | 'enabled'
  | 'locked'
  | 'triggerMode'
  | 'advancedMode'
  | 'errorPort'
  | 'retry'
  | 'branches'
  | 'subflow'
  | 'extra'

export type BlockChange =
  | { kind: 'param'; param: SubBlockId }
  | { kind: 'mode'; canonicalParamId: CanonicalParamId }
  | { kind: 'attribute'; attribute: BlockAttribute }

export interface CanonicalBlockDiff {
  /** The target key; equals the base key unless the block was renamed. */
  key: BlockKey
  baseKey: BlockKey
  changes: BlockChange[]
}

/** A key-based diff of two CWMs. The apply path turns it into an id-based summary. */
export interface CanonicalDiff {
  /** True iff every other field is empty. */
  noop: boolean
  meta: Array<keyof CanonicalWorkflowMeta>
  blocks: {
    added: BlockKey[]
    removed: BlockKey[]
    /** Pairs from `renames`; each also appears in `modified` (with a `name` change). */
    renamed: Array<{ from: BlockKey; to: BlockKey }>
    modified: CanonicalBlockDiff[]
  }
  edges: { added: CanonicalEdge[]; removed: CanonicalEdge[] }
  variables: { added: VarKey[]; removed: VarKey[]; modified: VarKey[] }
}

function edgeKey(edge: CanonicalEdge, keyOf: (key: BlockKey) => BlockKey): string {
  return `${keyOf(edge.from)}\u0000${portKey(edge.port)}\u0000${keyOf(edge.to)}`
}

/**
 * Diffs base against target. `renames` (target key → base key) pairs blocks whose key changed;
 * without it a rename is a remove plus an add. A rename pair whose base key is missing, or that
 * names a base key a target block of the same key also claims, is ignored. Edges are compared
 * after mapping target keys to base keys, so a rename alone moves no edge.
 */
export function diffCanonical(
  base: CanonicalWorkflow,
  target: CanonicalWorkflow,
  renames?: ReadonlyMap<BlockKey, BlockKey>
): CanonicalDiff {
  const pairs = new Map<BlockKey, BlockKey>()
  const claimedBase = new Set<BlockKey>()
  for (const [targetKey, baseKey] of renames ?? []) {
    if (
      Object.hasOwn(target.blocks, targetKey) &&
      Object.hasOwn(base.blocks, baseKey) &&
      !Object.hasOwn(target.blocks, baseKey) &&
      !claimedBase.has(baseKey)
    ) {
      pairs.set(targetKey, baseKey)
      claimedBase.add(baseKey)
    }
  }
  for (const targetKey of Object.keys(target.blocks)) {
    if (pairs.has(targetKey) || claimedBase.has(targetKey)) continue
    if (Object.hasOwn(base.blocks, targetKey)) {
      pairs.set(targetKey, targetKey)
      claimedBase.add(targetKey)
    }
  }
  const baseKeyOf = (targetKey: BlockKey) => pairs.get(targetKey) ?? targetKey

  const added = Object.keys(target.blocks).filter((key) => !pairs.has(key))
  const removed = Object.keys(base.blocks).filter((key) => !claimedBase.has(key))
  const renamed: CanonicalDiff['blocks']['renamed'] = []
  const modified: CanonicalBlockDiff[] = []
  for (const [targetKey, baseKey] of pairs) {
    if (targetKey !== baseKey) renamed.push({ from: baseKey, to: targetKey })
    const changes = blockChanges(base.blocks[baseKey], target.blocks[targetKey], baseKeyOf)
    if (changes.length > 0) modified.push({ key: targetKey, baseKey, changes })
  }

  const identityKey = (key: BlockKey) => key
  const baseEdges = new Set(base.edges.map((edge) => edgeKey(edge, identityKey)))
  const targetEdges = new Set(target.edges.map((edge) => edgeKey(edge, baseKeyOf)))
  const edges = {
    added: target.edges.filter((edge) => !baseEdges.has(edgeKey(edge, baseKeyOf))),
    removed: base.edges.filter((edge) => !targetEdges.has(edgeKey(edge, identityKey))),
  }

  const variables: CanonicalDiff['variables'] = { added: [], removed: [], modified: [] }
  for (const key of unionKeys(base.variables, target.variables)) {
    const before = base.variables[key]
    const after = target.variables[key]
    if (!before) variables.added.push(key)
    else if (!after) variables.removed.push(key)
    else if (!deepEqual(before, after)) variables.modified.push(key)
  }

  const meta = META_FIELDS.filter((field) => base.meta[field] !== target.meta[field])
  const noop =
    meta.length === 0 &&
    added.length === 0 &&
    removed.length === 0 &&
    renamed.length === 0 &&
    modified.length === 0 &&
    edges.added.length === 0 &&
    edges.removed.length === 0 &&
    variables.added.length === 0 &&
    variables.removed.length === 0 &&
    variables.modified.length === 0

  return {
    noop,
    meta,
    blocks: { added, removed, renamed, modified },
    edges,
    variables,
  }
}

/**
 * Block renames between two identities of one workflow (target key → base key): every block id
 * both carry under different keys. This is the `renames` input `diffCanonical` takes, from the
 * stored graph's identity and `materialize`'s.
 */
export function renamesBetween(base: LockIdentity, target: LockIdentity): Map<BlockKey, BlockKey> {
  const baseKeyById = new Map(Object.entries(base.blocks).map(([key, block]) => [block.id, key]))
  const renames = new Map<BlockKey, BlockKey>()
  for (const [key, block] of Object.entries(target.blocks)) {
    const baseKey = baseKeyById.get(block.id)
    if (baseKey !== undefined && baseKey !== key) renames.set(key, baseKey)
  }
  return renames
}
