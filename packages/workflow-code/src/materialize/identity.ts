import type { BlockState } from '@sim/workflow-types/workflow'
import type { CanonicalizeResult } from '../canonicalize'
import type { BlockCatalog } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type { MaterializeDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import { pointer, type WorkflowLockBlock, type WorkflowLockV1 } from '../lock'
import type { BlockKey, CanonicalWorkflow } from '../model'
import { deepEqual, getOwn } from '../records'
import type { MaterializeHooks } from './context'

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
    diagnostics.push({
      code: 'E_MAT_DUPLICATE_LOCK_ID',
      severity: 'error',
      message: `Lock keys ${keys.map((key) => `"${key}"`).join(', ')} all claim block id "${id}"`,
      path: pointer(['blocks', keys[1], 'id']),
    })
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
  /** The ids `resolved` holds, so a lock id's reuse check is one lookup. */
  const resolvedIds = new Set<string>()
  const resolve = (key: BlockKey, block: ResolvedBlock) => {
    resolved.set(key, block)
    resolvedIds.add(block.id)
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
      diagnostics.push({
        code: 'W_MAT_RETYPE_RECREATED',
        severity: 'warning',
        message: `Block "${key}" changed type from "${stored.type}" to "${target.type}"; it is deleted and re-created, so its webhook URL and schedules are lost`,
        blockKey: key,
      })
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
      claimed,
      open,
      match,
      settled,
      diagnostics,
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
      !resolvedIds.has(lockId)
    if (lockId !== undefined && !reusable) {
      diagnostics.push({
        code: 'W_MAT_LOCK_ID_CLAIMED',
        severity: 'warning',
        message: `Lock id "${lockId}" for block "${key}" already belongs to another block; a new id was minted`,
        blockKey: key,
      })
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
    diagnostics.push({
      code: 'W_MAT_DELETED_SINCE_PULL',
      severity: 'warning',
      message: `Block "${key}" (${lockId}) was deleted after the lock was pulled; it is re-created`,
      blockKey: key,
    })
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
}

/** `in:<id>` / `out:<id>` for every already-bound neighbour of a block. */
function neighbourhood(
  edges: CanonicalWorkflow['edges'],
  key: BlockKey,
  idOf: (key: BlockKey) => string | undefined
): Set<string> {
  const result = new Set<string>()
  for (const edge of edges) {
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

/**
 * Whether two blocks' params agree: equal on every param both hold, and holding at least one in
 * common. A param only one side holds is a default compile filled in or canvas state, which says
 * nothing about identity.
 */
function paramsAgree(
  left: CanonicalWorkflow['blocks'][string]['params'],
  right: CanonicalWorkflow['blocks'][string]['params']
): boolean {
  const shared = Object.keys(left).filter((id) => Object.hasOwn(right, id))
  return shared.length > 0 && shared.every((id) => deepEqual(left[id], right[id]))
}

/**
 * How rule 4 pairs a group: `connections`, a single unmatched block on each side whose bound
 * neighbours agree; `vacated`, a single unmatched block on each side where the stored one is a
 * block the lock binds (the source dropped its key and its ident: a rename of both, with its
 * wiring free to change); `params`, the one vacated stored block whose params agree with a
 * new block's, when several of one type were renamed at once.
 */
type InferenceBasis = 'connections' | 'vacated' | 'params'

const INFERENCE_REASON: Record<InferenceBasis, string> = {
  connections: 'same type, parent and connections',
  vacated: 'same type and parent, and the only block of them the source dropped',
  params: 'same type, parent and params',
}

/**
 * Identity rule 4, repeated until it binds nothing new so a renamed container lets its
 * renamed children pair next. A group is `(type, parent id)`. A group with exactly one unmatched
 * block on each side pairs when both have the same already-bound neighbours in the same
 * directions; failing that, and only once no group pairs that way, when the stored block is one
 * the lock binds (its key and ident both left the source), or, for several such blocks, the one
 * whose params agree with a new block's. Each pairing is flagged with `W_MAT_INFERRED_RENAME`.
 */
function inferRenames(state: InferenceState): void {
  const { workflow, prev, resolved, claimed, lockedIds } = state
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
    state.diagnostics.push({
      code: 'W_MAT_INFERRED_RENAME',
      severity: 'warning',
      message: `Block "${key}" is taken as a rename of "${prevKey}" (${INFERENCE_REASON[basis]}), so it keeps that block's id and run history. To make it a new block instead, delete "${prevKey}" in one apply and add "${key}" in the next`,
      blockKey: key,
    })
    return true
  }

  const byConnections = (): boolean => {
    let progressed = false
    for (const { targets, prevKeys } of groups()) {
      if (targets.length !== 1 || prevKeys.length !== 1) continue
      const [key] = targets
      const [prevKey] = prevKeys
      const agree = sameSet(
        neighbourhood(workflow.edges, key, idOfTarget),
        neighbourhood(prevCanonical.edges, prevKey, idOfPrev)
      )
      if (agree && pair(key, prevKey, 'connections')) progressed = true
    }
    return progressed
  }

  const byVacatedLock = (): boolean => {
    let progressed = false
    for (const { targets, prevKeys } of groups()) {
      const vacated = prevKeys.filter((prevKey) => lockedIds.has(prevIdentity[prevKey].id))
      if (vacated.length === 0) continue
      if (targets.length === 1 && prevKeys.length === 1 && vacated.length === 1) {
        if (pair(targets[0], vacated[0], 'vacated')) progressed = true
        continue
      }
      const equalParams = (key: BlockKey, prevKey: BlockKey) =>
        paramsAgree(workflow.blocks[key].params, prevCanonical.blocks[prevKey].params)
      for (const key of targets) {
        const [only, ...more] = vacated.filter((prevKey) => equalParams(key, prevKey))
        if (only === undefined || more.length > 0) continue
        if (targets.filter((other) => equalParams(other, only)).length !== 1) continue
        if (pair(key, only, 'params')) progressed = true
      }
    }
    return progressed
  }

  let progressed = true
  while (progressed) progressed = byConnections() || byVacatedLock()
}
