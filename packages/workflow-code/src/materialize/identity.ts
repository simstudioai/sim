import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import { type BlockState, normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import type { CanonicalizeResult } from '../canonicalize'
import type { BlockCatalog } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import { parseStoredPath } from '../code-files/ref-path'
import type { MaterializeDiagnosticCode } from '../diagnostics/codes'
import { diagnostic } from '../diagnostics/factory'
import type { Diagnostic } from '../diagnostics/frame'
import { pointer, type WorkflowLockBlock, type WorkflowLockV1 } from '../lock'
import {
  type BlockKey,
  type CanonicalBlock,
  type CanonicalWorkflow,
  isSimNode,
  type VarKey,
} from '../model'
import { deepEqual, getOwn, pushTo, strings } from '../records'
import type { MaterializeHooks } from './context'
import { settingsIndex } from './settings-index'

/** How identity rule matched a compiled block to a stored one (rules 1–4). */
type IdentityMatchRule = 'lock-key' | 'lock-ident' | 'db-name' | 'inferred'

/** One block's identity outcome, for plan output and audit. */
export type IdentityEntry =
  | {
      status: 'matched'
      key: BlockKey
      id: string
      via: IdentityMatchRule
      /** Set when the display name changed. */
      renamedFrom?: string
      /** Set for a catalog `sunset.replacedBy` retype that keeps the id. */
      retypedFrom?: string
      /** Set when the parent changed; `null` means it was at the root. */
      reparentedFrom?: BlockKey | null
    }
  | {
      status: 'created'
      key: BlockKey
      id: string
      /** `lock` when the lock's id was unclaimed and reused, else `minted`. */
      idSource: 'lock' | 'minted'
    }
  | { status: 'deleted'; key: BlockKey; id: string }

/** How the lock relates to the stored graph (`MaterializeOptions.lockFreshness`). */
export type LockFreshness = 'fresh' | 'stale' | 'none'

/** The stored graph being replaced, with its canonical projection (keys, identity). */
interface PrevGraph {
  state: { blocks: Record<string, BlockState> }
  canonical: CanonicalizeResult
}

/** One compiled block bound to an id. */
export interface ResolvedBlock {
  id: string
  /** The prev block this one continues, when matched; `null` for a created block. */
  prevKey: BlockKey | null
  /** True when the id is a lock id, so the lock's branch and item ids belong to it too. */
  lockOwned: boolean
  entry: IdentityEntry
}

export interface IdentityResolution {
  blocks: Map<BlockKey, ResolvedBlock>
  /** Prev blocks no compiled block continues, in stored order. */
  deleted: Array<Extract<IdentityEntry, { status: 'deleted' }>>
  /** Matched blocks whose key changed: prev key → new key. */
  renames: Array<{ from: BlockKey; to: BlockKey }>
}

interface IdentityInputs {
  workflow: CanonicalWorkflow
  lock: WorkflowLockV1 | null
  prev: PrevGraph | null
  catalog: BlockCatalog
  hooks: MaterializeHooks
  freshness: LockFreshness
  compiledIdents: Record<BlockKey, string> | undefined
  diagnostics: Diagnostic<MaterializeDiagnosticCode>[]
}

type TypeRelation = 'same' | 'replaced' | 'different'

/** A key that ends as a created block. */
interface SettledKey {
  /** The lock id to reuse for it, when unclaimed. */
  lockId?: string
  /** The prev block it matched across types, which rename inference must not hand to another. */
  retypedPrevId?: string
}

/** A key match across types keeps the id only for a catalog `sunset.replacedBy` pair. */
function typeRelation(catalog: BlockCatalog, prevType: string, nextType: string): TypeRelation {
  if (prevType === nextType) return 'same'
  return catalogBlock(catalog, prevType)?.lifecycle?.sunset?.replacedBy === nextType
    ? 'replaced'
    : 'different'
}

/** Lock keys whose id another lock key also claims (`E_MAT_DUPLICATE_LOCK_ID`). */
function duplicateLockKeys(
  lock: WorkflowLockV1 | null,
  diagnostics: IdentityInputs['diagnostics']
): Set<BlockKey> {
  const keysById = new Map<string, BlockKey[]>()
  for (const [key, entry] of Object.entries(lock?.blocks ?? {})) {
    const keys = keysById.get(entry.id)
    if (keys) keys.push(key)
    else keysById.set(entry.id, [key])
  }
  const duplicates = new Set<BlockKey>()
  for (const [id, keys] of keysById) {
    if (keys.length < 2) continue
    for (const key of keys) duplicates.add(key)
    diagnostics.push(
      diagnostic(
        'E_MAT_DUPLICATE_LOCK_ID',
        `Lock keys ${keys.map((key) => `"${key}"`).join(', ')} all claim block id "${id}"`,
        {
          path: pointer(['blocks', keys[1], 'id']),
        }
      )
    )
  }
  return duplicates
}

/**
 * Binds every compiled block to an id, in rule order:
 * 1. the lock entry under the same key, when its id is in prev;
 * 2. a lock entry whose key the file dropped but whose ident the file still uses;
 * 3. the prev block with the same canonical key (the lockless and stale-lock path);
 * 4. an inferred rename: exactly one unmatched prev block and one unmatched compiled block with
 *    the same type and parent and agreeing edge neighbourhoods, so renaming the variable and the
 *    display name together (an editor's rename-symbol) keeps the id;
 * 5. otherwise a new id (the lock's id when it is unclaimed, else a minted one).
 *
 * A match across types is a delete plus a create (`W_MAT_RETYPE_RECREATED`), except a catalog
 * `sunset.replacedBy` pair, which keeps the id. A stale lock entry whose id left prev is ignored;
 * when no later rule matches its key, the block is created with `W_MAT_DELETED_SINCE_PULL`.
 * Lock keys sharing one id are ignored with `E_MAT_DUPLICATE_LOCK_ID`.
 */
export function resolveIdentity(inputs: IdentityInputs): IdentityResolution {
  const { workflow, lock, prev, catalog, hooks, diagnostics } = inputs
  const prevBlocks = prev?.state.blocks ?? {}
  const prevIdentity = prev?.canonical.identity.blocks ?? {}
  const prevCanonical = prev?.canonical.workflow.blocks ?? {}
  const prevKeyById = new Map(Object.entries(prevIdentity).map(([key, block]) => [block.id, key]))
  const duplicates = duplicateLockKeys(lock, diagnostics)
  const lockEntry = (key: BlockKey) =>
    lock && !duplicates.has(key) ? getOwn(lock.blocks, key) : undefined
  const compiledIdent = (key: BlockKey) =>
    inputs.compiledIdents ? getOwn(inputs.compiledIdents, key) : undefined

  const resolved = new Map<BlockKey, ResolvedBlock>()
  /** The key `resolved` holds each id under, so finding an id's block is one lookup. */
  const keyOfId = new Map<string, BlockKey>()
  const resolve = (key: BlockKey, block: ResolvedBlock) => {
    resolved.set(key, block)
    keyOfId.set(block.id, key)
  }
  const claimed = new Set<string>()
  /** Keys that end as created blocks no later rule may match (retype, or a lock id to reuse). */
  const settled = new Map<BlockKey, SettledKey>()

  const match = (key: BlockKey, prevId: string, via: IdentityMatchRule): boolean => {
    const target = workflow.blocks[key]
    const stored = getOwn(prevBlocks, prevId)
    const prevKey = prevKeyById.get(prevId)
    if (!stored || prevKey === undefined || claimed.has(prevId)) return false
    const relation = typeRelation(catalog, stored.type, target.type)
    if (relation === 'different') {
      diagnostics.push(
        diagnostic(
          'W_MAT_RETYPE_RECREATED',
          `Block "${key}" changed type from "${stored.type}" to "${target.type}"; it is deleted and re-created, so its webhook URL and schedules are lost`,
          {
            blockKey: key,
          }
        )
      )
      settled.set(key, { retypedPrevId: prevId })
      return true
    }
    claimed.add(prevId)
    const entry: IdentityEntry = { status: 'matched', key, id: prevId, via }
    if (stored.name !== target.name) entry.renamedFrom = stored.name
    if (relation === 'replaced') entry.retypedFrom = stored.type
    resolve(key, {
      id: prevId,
      prevKey,
      lockOwned: via === 'lock-key' || via === 'lock-ident',
      entry,
    })
    return true
  }

  const keys = Object.keys(workflow.blocks)
  const open = () => keys.filter((key) => !resolved.has(key) && !settled.has(key))

  /**
   * A key whose ident in the file now belongs to another lock entry: in a chain rename (A takes
   * B's name while B takes a new one) the key is B's, but the block is A's, so rule 2 binds it.
   */
  const identOwner = new Map<string, BlockKey>()
  for (const [key, entry] of Object.entries(lock?.blocks ?? {})) {
    if (!duplicates.has(key)) identOwner.set(entry.ident, key)
  }
  const identMoved = (key: BlockKey): boolean => {
    const ident = compiledIdent(key)
    const entry = lockEntry(key)
    if (ident === undefined || !entry || entry.ident === ident) return false
    const owner = identOwner.get(ident)
    return owner !== undefined && owner !== key
  }

  /** Stale lock entries whose id left prev; reported only if no later rule matches the key. */
  const deletedSincePull = new Map<BlockKey, string>()
  for (const key of keys) {
    const entry = lockEntry(key)
    if (!entry || identMoved(key)) continue
    if (Object.hasOwn(prevBlocks, entry.id)) {
      match(key, entry.id, 'lock-key')
    } else if (prev && inputs.freshness === 'stale') {
      deletedSincePull.set(key, entry.id)
    } else {
      settled.set(key, { lockId: entry.id })
    }
  }

  /** Lock entries rule 2 may bind, by ident, in lock order. */
  const identEntries = new Map<string, WorkflowLockBlock[]>()
  for (const [key, entry] of Object.entries(lock?.blocks ?? {})) {
    if (duplicates.has(key)) continue
    if (Object.hasOwn(workflow.blocks, key) && compiledIdent(key) === entry.ident) continue
    const entries = identEntries.get(entry.ident)
    if (entries) entries.push(entry)
    else identEntries.set(entry.ident, [entry])
  }
  for (const key of open()) {
    if (lockEntry(key) && !identMoved(key)) continue
    const ident = compiledIdent(key)
    if (ident === undefined) continue
    const found = identEntries.get(ident)?.find((entry) => Object.hasOwn(prevBlocks, entry.id))
    if (found) match(key, found.id, 'lock-ident')
  }

  for (const key of open()) {
    const prevId = getOwn(prevIdentity, key)?.id
    if (prevId !== undefined) match(key, prevId, 'db-name')
  }

  if (prev) {
    inferRenames({
      workflow,
      prev,
      resolved,
      keyOfId,
      claimed,
      open,
      match,
      settled,
      diagnostics,
      catalog,
      lockedIds: new Set(
        Object.entries(lock?.blocks ?? {}).flatMap(([key, entry]) =>
          duplicates.has(key) ? [] : [entry.id]
        )
      ),
    })
  }

  for (const key of open()) settled.set(key, {})
  for (const [key, { lockId }] of settled) {
    const reusable =
      lockId !== undefined &&
      !claimed.has(lockId) &&
      !Object.hasOwn(prevBlocks, lockId) &&
      !keyOfId.has(lockId)
    if (lockId !== undefined && !reusable) {
      diagnostics.push(
        diagnostic(
          'W_MAT_LOCK_ID_CLAIMED',
          `Lock id "${lockId}" for block "${key}" already belongs to another block; a new id was minted`,
          {
            blockKey: key,
          }
        )
      )
    }
    const id = reusable ? lockId : hooks.newId()
    resolve(key, {
      id,
      prevKey: null,
      lockOwned: reusable,
      entry: { status: 'created', key, id, idSource: reusable ? 'lock' : 'minted' },
    })
  }
  for (const [key, lockId] of deletedSincePull) {
    if (resolved.get(key)?.entry.status !== 'created') continue
    diagnostics.push(
      diagnostic(
        'W_MAT_DELETED_SINCE_PULL',
        `Block "${key}" (${lockId}) was deleted after the lock was pulled; it is re-created`,
        {
          blockKey: key,
        }
      )
    )
  }

  for (const [key, block] of resolved) {
    if (block.entry.status !== 'matched' || block.prevKey === null) continue
    const prevParent = getOwn(prevCanonical, block.prevKey)?.parent ?? null
    const prevParentId = prevParent !== null ? (getOwn(prevIdentity, prevParent)?.id ?? null) : null
    const parent = workflow.blocks[key].parent
    const parentId = parent !== null ? (resolved.get(parent)?.id ?? null) : null
    if (parentId !== prevParentId) block.entry.reparentedFrom = prevParent
  }

  const ordered = new Map<BlockKey, ResolvedBlock>()
  for (const key of keys) {
    const block = resolved.get(key)
    if (block) ordered.set(key, block)
  }
  const deleted: IdentityResolution['deleted'] = []
  for (const [key, block] of Object.entries(prevIdentity)) {
    if (!claimed.has(block.id)) deleted.push({ status: 'deleted', key, id: block.id })
  }
  const renames: IdentityResolution['renames'] = []
  for (const [key, block] of ordered) {
    if (block.prevKey !== null && block.prevKey !== key)
      renames.push({ from: block.prevKey, to: key })
  }
  return { blocks: ordered, deleted, renames }
}

interface InferenceState {
  workflow: CanonicalWorkflow
  prev: PrevGraph
  resolved: Map<BlockKey, ResolvedBlock>
  keyOfId: ReadonlyMap<string, BlockKey>
  claimed: Set<string>
  open: () => BlockKey[]
  match: (key: BlockKey, prevId: string, via: IdentityMatchRule) => boolean
  settled: Map<BlockKey, SettledKey>
  diagnostics: IdentityInputs['diagnostics']
  /**
   * The ids the lock binds: blocks the author's source held. After rules 1–3 such a block is
   * unmatched only when the source dropped both its key and its ident.
   */
  lockedIds: ReadonlySet<string>
  catalog: BlockCatalog
}

type CanonicalEdges = CanonicalWorkflow['edges']

/** Each block's edges, in or out, so a block's neighbourhood reads only its own edges. */
function edgesByEndpoint(edges: CanonicalEdges): Map<BlockKey, CanonicalEdges> {
  const byKey = new Map<BlockKey, CanonicalEdges>()
  for (const edge of edges) {
    pushTo(byKey, edge.from, edge)
    if (edge.to !== edge.from) pushTo(byKey, edge.to, edge)
  }
  return byKey
}

/** `in:<id>` / `out:<id>` for every already-bound neighbour of a block. */
function neighbourhood(
  edgesAt: ReadonlyMap<BlockKey, CanonicalEdges>,
  key: BlockKey,
  idOf: (key: BlockKey) => string | undefined
): Set<string> {
  const result = new Set<string>()
  for (const edge of edgesAt.get(key) ?? []) {
    if (edge.from === key) {
      const id = idOf(edge.to)
      if (id !== undefined) result.add(`out:${id}`)
    }
    if (edge.to === key) {
      const id = idOf(edge.from)
      if (id !== undefined) result.add(`in:${id}`)
    }
  }
  return result
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item))
}

/** `value` with every `<from.` / `<from>` reference token rewritten to `to`. */
function withKeyRenamed(value: unknown, from: BlockKey, to: BlockKey): unknown {
  if (typeof value === 'string') {
    return value.split(`<${from}.`).join(`<${to}.`).split(`<${from}>`).join(`<${to}>`)
  }
  if (Array.isArray(value)) return value.map((item) => withKeyRenamed(item, from, to))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withKeyRenamed(item, from, to)])
  )
}

/**
 * Whether two blocks' settings are equal, references to the renamed block's old key read as its
 * new one: equal on every param both hold, and holding at least one in common. A param only one
 * side holds is a default compile filled in or canvas state, which says nothing about identity.
 */
function settingsAgree(
  target: CanonicalBlock,
  prev: CanonicalBlock,
  key: BlockKey,
  prevKey: BlockKey
): boolean {
  let shared = false
  for (const [id, value] of Object.entries(target.params)) {
    if (!Object.hasOwn(prev.params, id)) continue
    if (!deepEqual(value, withKeyRenamed(prev.params[id], prevKey, key))) return false
    shared = true
  }
  return shared
}

/**
 * The keys a block references in any field a reference can sit in (its params, a condition or
 * router's branches, a loop or parallel's collection), each head read as the resolver reads it:
 * normalized, so `<Fetch.data>` references `fetch`.
 */
function referencedKeys(block: CanonicalBlock): Set<BlockKey> {
  const keys = new Set<BlockKey>()
  for (const text of strings([block.params, block.branches, block.subflow])) {
    for (const token of findWorkflowReferenceTokens(text)) {
      if (token.kind !== 'workflow') continue
      const head = parseStoredPath(token.value.slice(1, -1))?.[0]
      if (head?.kind === 'name') keys.add(normalizeWorkflowBlockName(head.name))
    }
  }
  return keys
}

/**
 * The first half (rounded up) of a block's bound neighbours in `order`. Two blocks share a
 * majority of their neighbours, the `connections` signal, only if these halves meet: the earliest
 * shared neighbour sits in both, since more than half of each side's neighbours are shared and
 * come at or after it.
 */
function neighbourPrefix(items: Set<string>, order: (left: string, right: string) => number) {
  return [...items].sort(order).slice(0, Math.ceil(items.size / 2))
}

/** Each key's items, inverted: item → the keys that hold it. */
function invert(entries: Iterable<[BlockKey, Iterable<string>]>): Map<string, BlockKey[]> {
  const byItem = new Map<string, BlockKey[]>()
  for (const [key, items] of entries) {
    for (const item of items) pushTo(byItem, item, key)
  }
  return byItem
}

/**
 * Whether a block reads variable `key`: a `<variable.key>` reference in any field a reference can
 * sit in, or a variable node (a Variables block's assignment target).
 */
export function referencesVariable(block: CanonicalBlock, key: VarKey): boolean {
  const reads = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return findWorkflowReferenceTokens(value).some((token) => {
        if (token.kind !== 'workflow') return false
        const [head, name] = parseStoredPath(token.value.slice(1, -1)) ?? []
        return (
          head?.kind === 'name' &&
          head.name === 'variable' &&
          name?.kind === 'name' &&
          normalizeWorkflowBlockName(name.name) === key
        )
      })
    }
    if (Array.isArray(value)) return value.some(reads)
    if (value === null || typeof value !== 'object') return false
    if (isSimNode(value)) return value.$sim === 'var' && value.key === key
    return Object.values(value).some(reads)
  }
  return reads([block.params, block.branches, block.subflow])
}

/**
 * The strong identity signal that ties a new block to a vacated stored one, if any: `settings`,
 * equal settings (references to the old key read as the new); `connections`, most of their
 * already-bound neighbours shared; `references`, every bound block that referenced the old key
 * now references the new one (the author renamed the references).
 */
type InferenceBasis = 'connections' | 'settings' | 'references'

const INFERENCE_REASON: Record<InferenceBasis, string> = {
  connections: 'same type, parent and connections',
  settings: 'same type, parent and settings',
  references: 'same type and parent, and the references to it renamed with it',
}

/**
 * Whether a block acts as a trigger: its id serves webhook paths, schedules and run history, so
 * rule 4 binds one only on equal settings.
 */
function isTriggerLike(block: CanonicalBlock, catalog: BlockCatalog): boolean {
  const declared = catalogBlock(catalog, block.type)
  return (
    block.triggerMode || declared?.category === 'triggers' || declared?.graph.canBeTarget === false
  )
}

/**
 * Identity rule 4, repeated until it binds nothing new so a renamed container lets its renamed
 * children pair next. A group is `(type, parent id)`. A group with exactly one unmatched block on
 * each side pairs when both have the same already-bound neighbours in the same directions; then,
 * once no group pairs that way, a new block pairs with a stored block the lock binds (its key and
 * ident both left the source) when exactly one such block of its group, and no other new block,
 * shows a strong identity signal ({@link InferenceBasis}). A trigger pairs only on equal
 * settings. Each pairing is flagged with `W_MAT_INFERRED_RENAME`; a delete and an add that show
 * no signal stay a delete, which `--allow-delete` guards.
 */
function inferRenames(state: InferenceState): void {
  const { workflow, prev, resolved, claimed, lockedIds, catalog } = state
  const prevCanonical = prev.canonical.workflow
  const prevIdentity = prev.canonical.identity.blocks
  /** Prev blocks a settled key accounts for: a retype's own prev, else the prev under its key. */
  const retyped = new Set(
    [...state.settled].flatMap(([key, { retypedPrevId }]) => {
      const id = retypedPrevId ?? getOwn(prevIdentity, key)?.id
      return id !== undefined ? [id] : []
    })
  )
  const idOfTarget = (key: BlockKey) => resolved.get(key)?.id
  const idOfPrev = (key: BlockKey) => {
    const id = getOwn(prevIdentity, key)?.id
    return id !== undefined && claimed.has(id) ? id : undefined
  }

  const groups = () => {
    const targetGroups = new Map<string, BlockKey[]>()
    for (const key of state.open()) {
      const block = workflow.blocks[key]
      const parentId = block.parent === null ? '' : idOfTarget(block.parent)
      if (parentId === undefined) continue
      const group = `${block.type}\u0000${parentId}`
      const keys = targetGroups.get(group)
      if (keys) keys.push(key)
      else targetGroups.set(group, [key])
    }
    const prevGroups = new Map<string, BlockKey[]>()
    for (const [key, identity] of Object.entries(prevIdentity)) {
      if (claimed.has(identity.id) || retyped.has(identity.id)) continue
      const block = prevCanonical.blocks[key]
      const parentId = block.parent === null ? '' : idOfPrev(block.parent)
      if (parentId === undefined) continue
      const group = `${block.type}\u0000${parentId}`
      const keys = prevGroups.get(group)
      if (keys) keys.push(key)
      else prevGroups.set(group, [key])
    }
    return [...targetGroups].flatMap(([group, targets]) => {
      const prevKeys = prevGroups.get(group)
      return prevKeys ? [{ targets, prevKeys }] : []
    })
  }

  const pair = (key: BlockKey, prevKey: BlockKey, basis: InferenceBasis): boolean => {
    if (!state.match(key, prevIdentity[prevKey].id, 'inferred')) return false
    state.diagnostics.push(
      diagnostic(
        'W_MAT_INFERRED_RENAME',
        `Block "${key}" is taken as a rename of "${prevKey}" (${INFERENCE_REASON[basis]}), so it keeps that block's id and run history. To make it a new block instead, delete "${prevKey}" in one apply and add "${key}" in the next`,
        {
          blockKey: key,
        }
      )
    )
    return true
  }

  const targetEdges = edgesByEndpoint(workflow.edges)
  const prevEdges = edgesByEndpoint(prevCanonical.edges)
  const targetSide = (key: BlockKey) => neighbourhood(targetEdges, key, idOfTarget)
  const prevSide = (prevKey: BlockKey) => neighbourhood(prevEdges, prevKey, idOfPrev)

  /** Each stored block's referrers: the other stored blocks that reference its key. */
  const referrersOf = new Map<BlockKey, BlockKey[]>()
  for (const [other, block] of Object.entries(prevCanonical.blocks)) {
    for (const key of referencedKeys(block)) {
      if (key !== other && Object.hasOwn(prevCanonical.blocks, key)) pushTo(referrersOf, key, other)
    }
  }
  const targetReferences = new Map<BlockKey, Set<BlockKey>>()
  const referencedByTarget = (key: BlockKey): Set<BlockKey> => {
    let keys = targetReferences.get(key)
    if (!keys) {
      keys = referencedKeys(workflow.blocks[key])
      targetReferences.set(key, keys)
    }
    return keys
  }
  /** The blocks that now stand where `prevKey`'s referrers stood, or none when one is unbound. */
  const renamedReferrers = (prevKey: BlockKey): BlockKey[] => {
    const now: BlockKey[] = []
    for (const other of referrersOf.get(prevKey) ?? []) {
      const id = idOfPrev(other)
      const key = id === undefined ? undefined : state.keyOfId.get(id)
      if (key === undefined) return []
      now.push(key)
    }
    return now
  }

  const byConnections = (): boolean => {
    let progressed = false
    for (const { targets, prevKeys } of groups()) {
      if (targets.length !== 1 || prevKeys.length !== 1) continue
      const [key] = targets
      const [prevKey] = prevKeys
      if (!sameSet(targetSide(key), prevSide(prevKey))) continue
      const triggerHeld =
        isTriggerLike(workflow.blocks[key], catalog) &&
        !settingsAgree(workflow.blocks[key], prevCanonical.blocks[prevKey], key, prevKey)
      if (!triggerHeld && pair(key, prevKey, 'connections')) progressed = true
    }
    return progressed
  }

  /** Bound neighbourhoods of one group's blocks, read once per group. */
  interface GroupSides {
    targets: Map<BlockKey, Set<string>>
    vacated: Map<BlockKey, Set<string>>
  }

  /** The strong signal tying new block `key` to vacated stored block `prevKey`, if any. */
  const signal = (key: BlockKey, prevKey: BlockKey, sides: GroupSides): InferenceBasis | null => {
    const target = workflow.blocks[key]
    if (settingsAgree(target, prevCanonical.blocks[prevKey], key, prevKey)) return 'settings'
    if (isTriggerLike(target, catalog)) return null
    const targetItems = sides.targets.get(key) ?? new Set<string>()
    const prevItems = sides.vacated.get(prevKey) ?? new Set<string>()
    const shared = [...targetItems].filter((item) => prevItems.has(item)).length
    const union = targetItems.size + prevItems.size - shared
    if (shared > 0 && shared * 2 > union) return 'connections'
    const referrers = renamedReferrers(prevKey)
    const renamedAtEverySite =
      referrers.length > 0 && referrers.every((now) => referencedByTarget(now).has(key))
    return renamedAtEverySite ? 'references' : null
  }

  /**
   * The pairs of one group that may show a signal, found from either side without judging every
   * pair: equal settings ({@link settingsIndex}), shared neighbours ({@link neighbourPrefix}), or
   * every referrer now referencing the new block. A superset, so {@link signal} need judge only
   * these.
   */
  const groupSearch = (sides: GroupSides) => {
    const blocksOf = (keys: Iterable<BlockKey>, from: CanonicalWorkflow) =>
      [...keys].map((key): [BlockKey, CanonicalBlock] => [key, from.blocks[key]])
    const vacatedBySettings = settingsIndex(blocksOf(sides.vacated.keys(), prevCanonical))
    const targetsBySettings = settingsIndex(blocksOf(sides.targets.keys(), workflow))

    const frequency = new Map<string, number>()
    for (const items of [...sides.targets.values(), ...sides.vacated.values()]) {
      for (const item of items) frequency.set(item, (frequency.get(item) ?? 0) + 1)
    }
    const order = (left: string, right: string) =>
      (frequency.get(left) ?? 0) - (frequency.get(right) ?? 0) || (left < right ? -1 : 1)
    const prefixes = (side: Map<BlockKey, Set<string>>) =>
      new Map([...side].map(([key, items]) => [key, neighbourPrefix(items, order)]))
    const targetPrefixes = prefixes(sides.targets)
    const vacatedPrefixes = prefixes(sides.vacated)
    const vacatedByNeighbour = invert(vacatedPrefixes)
    const targetsByNeighbour = invert(targetPrefixes)

    const referenced = new Map<BlockKey, BlockKey[]>()
    for (const prevKey of sides.vacated.keys()) {
      const [first, ...rest] = renamedReferrers(prevKey).map(referencedByTarget)
      referenced.set(
        prevKey,
        [...(first ?? [])].filter(
          (key) => sides.targets.has(key) && rest.every((keys) => keys.has(key))
        )
      )
    }
    const referencing = invert(referenced)

    function* unique(lists: Iterable<Iterable<BlockKey>>): Generator<BlockKey> {
      const seen = new Set<BlockKey>()
      for (const list of lists) {
        for (const key of list) {
          if (seen.has(key)) continue
          seen.add(key)
          yield key
        }
      }
    }
    return {
      vacatedFor: (key: BlockKey) =>
        unique([
          vacatedBySettings(workflow.blocks[key]),
          ...(targetPrefixes.get(key) ?? []).map((item) => vacatedByNeighbour.get(item) ?? []),
          referencing.get(key) ?? [],
        ]),
      targetsFor: (prevKey: BlockKey) =>
        unique([
          targetsBySettings(prevCanonical.blocks[prevKey]),
          ...(vacatedPrefixes.get(prevKey) ?? []).map((item) => targetsByNeighbour.get(item) ?? []),
          referenced.get(prevKey) ?? [],
        ]),
    }
  }

  /**
   * Pairs each new block that shows a signal for exactly one vacated block, which no other new
   * block shows one for. A new block stops at its second signal, since it can no longer pair; a
   * vacated block's rivals are then sought only for the new blocks that would pair with it.
   */
  const byVacatedLock = (): boolean => {
    let progressed = false
    for (const { targets, prevKeys } of groups()) {
      const vacated = prevKeys.filter((prevKey) => lockedIds.has(prevIdentity[prevKey].id))
      if (vacated.length === 0) continue
      const sides: GroupSides = {
        targets: new Map(targets.map((key) => [key, targetSide(key)])),
        vacated: new Map(vacated.map((prevKey) => [prevKey, prevSide(prevKey)])),
      }
      const search = groupSearch(sides)
      const chosen: Array<[BlockKey, BlockKey, InferenceBasis]> = []
      for (const key of targets) {
        const found: Array<[BlockKey, InferenceBasis]> = []
        for (const prevKey of search.vacatedFor(key)) {
          const basis = signal(key, prevKey, sides)
          if (basis) found.push([prevKey, basis])
          if (found.length > 1) break
        }
        if (found.length !== 1) continue
        const [[prevKey, basis]] = found
        let rivalled = false
        for (const other of search.targetsFor(prevKey)) {
          if (other !== key && signal(other, prevKey, sides) !== null) {
            rivalled = true
            break
          }
        }
        if (!rivalled) chosen.push([key, prevKey, basis])
      }
      for (const [key, prevKey, basis] of chosen) {
        if (pair(key, prevKey, basis)) progressed = true
      }
    }
    return progressed
  }

  let progressed = true
  while (progressed) progressed = byConnections() || byVacatedLock()
}
