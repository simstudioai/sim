import {
  type BlockState,
  type Loop,
  normalizeWorkflowEdgeSourceHandle,
  type Parallel,
  type Variable,
  WORKFLOW_ERROR_HANDLE_ID,
  type WorkflowState,
} from '@sim/workflow-types/workflow'
import { type CanonicalizeResult, canonicalize } from '../canonicalize'
import type { BlockCatalog } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type { MaterializeDiagnosticCode } from '../diagnostics/codes'
import { diagnostic } from '../diagnostics/factory'
import type { Diagnostic } from '../diagnostics/frame'
import type { LockIdentity, LockIdentityBlock, WorkflowLockBlock, WorkflowLockV1 } from '../lock'
import type {
  BlockKey,
  CanonicalBlock,
  CanonicalWorkflow,
  ResourceKeyResolver,
  VarKey,
} from '../model'
import { deepEqual, getOwn, invertRecord, setOwn } from '../records'
import { type BuiltBlock, buildBlock } from './block'
import type { MaterializeContext, MaterializeHooks } from './context'
import { type BranchHandles, writeEdges } from './edges'
import {
  type IdentityEntry,
  type LockFreshness,
  referencesVariable,
  resolveIdentity,
} from './identity'
import { restorePreserved } from './preserve'
import { sharesEvidence, soleRename } from './rename'
import { loopEntry, parallelEntry } from './subflows'
import { rewriteRenamedReferences, rewriteStoredBlockReferences } from './values'

/**
 * Variables keep their ids by key: the lock's id, then prev's, else a new one. When exactly one
 * variable's key is new and exactly one prev variable's key is gone, with the same type, the
 * variable is a rename and keeps that id. A variable canonical-equal to the prev variable with
 * that id is prev's stored object unchanged, and continuing variables keep their stored order.
 */
function writeVariables(
  workflow: CanonicalWorkflow,
  lock: WorkflowLockV1 | null,
  prev: WorkflowState | undefined,
  prevCanonical: CanonicalizeResult | null,
  hooks: MaterializeHooks,
  keyByPrevKey: ReadonlyMap<BlockKey, BlockKey>
): { variables: Record<string, Variable>; idByKey: Map<VarKey, string> } {
  const prevVariables = prev?.variables ?? {}
  const prevKeyById = invertRecord(prevCanonical?.identity.variables ?? {})
  const lockIds = lock?.variables ?? {}
  const lockIdCounts = new Map<string, number>()
  for (const id of Object.values(lockIds)) lockIdCounts.set(id, (lockIdCounts.get(id) ?? 0) + 1)

  const used = new Set<string>()
  const knownIds = new Map<VarKey, string>()
  for (const key of Object.keys(workflow.variables)) {
    const fromLock = getOwn(lockIds, key)
    const candidates = [
      fromLock !== undefined && lockIdCounts.get(fromLock) === 1 ? fromLock : undefined,
      prevCanonical ? getOwn(prevCanonical.identity.variables, key) : undefined,
    ]
    const known = candidates.find(
      (candidate): candidate is string =>
        candidate !== undefined &&
        !used.has(candidate) &&
        (!Object.hasOwn(prevVariables, candidate) || prevKeyById.get(candidate) === key)
    )
    if (known === undefined) continue
    used.add(known)
    knownIds.set(key, known)
  }
  const renamed = renamedVariable(workflow, knownIds, prevCanonical, used, keyByPrevKey)
  if (renamed) knownIds.set(renamed.key, renamed.id)

  const variables: Record<string, Variable> = {}
  const idByKey = new Map<VarKey, string>()
  for (const [key, variable] of Object.entries(workflow.variables)) {
    const id = knownIds.get(key) ?? hooks.newId()
    used.add(id)
    idByKey.set(key, id)
    const stored = getOwn(prevVariables, id)
    const prevKey = prevKeyById.get(id)
    const before =
      prevKey !== undefined && prevCanonical
        ? getOwn(prevCanonical.workflow.variables, prevKey)
        : undefined
    const unchanged =
      stored !== undefined &&
      before !== undefined &&
      before.name === variable.name &&
      before.type === variable.type &&
      deepEqual(before.value, variable.value)
    setOwn(
      variables,
      id,
      unchanged
        ? stored
        : { ...stored, id, name: variable.name, type: variable.type, value: variable.value }
    )
  }
  return { variables: inStoredOrder(variables, prevVariables), idByKey }
}

/**
 * `variables` with the ones `stored` holds first, in its order, then the new ones in source order.
 * The panel lists variables in record order and the printer sorts them by key, so writing them in
 * source order would reorder the panel on every apply that touches a variable.
 */
function inStoredOrder(
  variables: Record<string, Variable>,
  stored: Readonly<Record<string, Variable>>
): Record<string, Variable> {
  const ordered: Record<string, Variable> = {}
  for (const id of Object.keys(stored)) {
    const variable = getOwn(variables, id)
    if (variable) setOwn(ordered, id, variable)
  }
  for (const [id, variable] of Object.entries(variables)) {
    if (!Object.hasOwn(ordered, id)) setOwn(ordered, id, variable)
  }
  return ordered
}

/** The one variable a lone key rename left without a known id, with its id (see {@link soleRename}). */
function renamedVariable(
  workflow: CanonicalWorkflow,
  knownIds: ReadonlyMap<VarKey, string>,
  prevCanonical: CanonicalizeResult | null,
  used: ReadonlySet<string>,
  keyByPrevKey: ReadonlyMap<BlockKey, BlockKey>
): { key: VarKey; id: string } | null {
  if (!prevCanonical) return null
  const renamed = soleRename(
    Object.keys(workflow.variables).filter((key) => !knownIds.has(key)),
    Object.entries(prevCanonical.identity.variables).flatMap(([key, id]) =>
      !Object.hasOwn(workflow.variables, key) && !used.has(id) ? [[id, key] as const] : []
    ),
    (key, formerKey) => {
      const former = getOwn(prevCanonical.workflow.variables, formerKey)
      const variable = getOwn(workflow.variables, key)
      return (
        former !== undefined &&
        variable !== undefined &&
        former.type === variable.type &&
        (sharesEvidence(former, variable, ['value']) ||
          (deepEqual(former.value, variable.value) &&
            referencesFollow(prevCanonical.workflow, workflow, formerKey, key, keyByPrevKey)))
      )
    }
  )
  return renamed && { key: renamed.item, id: renamed.id }
}

/**
 * Whether every block that read variable `formerKey` now reads `key` instead: the evidence a
 * rename carries when the value itself says nothing (`0`, `false`, `''`), as it does for counters
 * and flags. Each reader is found by the block it resolved to (`keyByPrevKey`), so a reader
 * renamed in the same edit still counts.
 */
function referencesFollow(
  prev: CanonicalWorkflow,
  workflow: CanonicalWorkflow,
  formerKey: VarKey,
  key: VarKey,
  keyByPrevKey: ReadonlyMap<BlockKey, BlockKey>
): boolean {
  const readers = Object.values(prev.blocks).filter((block) => referencesVariable(block, formerKey))
  return (
    readers.length > 0 &&
    readers.every((block) => {
      const current = keyByPrevKey.get(block.key)
      const now = current === undefined ? undefined : getOwn(workflow.blocks, current)
      return now !== undefined && referencesVariable(now, key)
    })
  )
}

/**
 * Each matched block with the preserved UI state of the stored block it continues
 * (`restorePreserved`): source holds what executes, and the rest comes from prev.
 */
function withPreservedState(
  workflow: CanonicalWorkflow,
  prevBlock: (key: BlockKey) => CanonicalBlock | undefined,
  catalog: BlockCatalog
): CanonicalWorkflow {
  const blocks: Record<BlockKey, CanonicalBlock> = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const prev = prevBlock(key)
    setOwn(blocks, key, prev ? restorePreserved(block, prev, catalog) : block)
  }
  return { ...workflow, blocks }
}

/** Each container's child ids (`data.parentId`), in block order, from one pass over the blocks. */
function childrenByParent(blocks: Record<string, BlockState>): Map<unknown, string[]> {
  const children = new Map<unknown, string[]>()
  for (const [id, block] of Object.entries(blocks)) {
    const parent = block.data?.parentId
    if (parent === undefined) continue
    const ids = children.get(parent)
    if (ids) ids.push(id)
    else children.set(parent, [id])
  }
  return children
}

export interface MaterializeOptions {
  catalog: BlockCatalog
  hooks: MaterializeHooks
  /** The stored graph being replaced. Absent for a new workflow. */
  prev?: WorkflowState
  /**
   * `prev` canonicalized under `lock` with `resources`, when the caller already holds it; only its
   * blocks, edges, variables and identity are read, so its `meta` may differ from the input's.
   */
  prevCanonical?: CanonicalizeResult
  resources?: ResourceKeyResolver
  /**
   * Idents as written in the compiled file (`CompileResult.hints`), by block key. Identity
   * rule 2 matches a lock entry whose key is gone by its ident, so a human who edits only the
   * display string keeps the block's id.
   */
  compiledIdents?: Record<BlockKey, string>
  /**
   * How the lock relates to `prev`: `fresh` when its base fingerprint matches the stored graph,
   * `stale` when it does not, `none` when there is no lock. A `stale` lock entry whose id left
   * prev is re-created with `W_MAT_DELETED_SINCE_PULL` unless a later rule matches its key.
   * Rule 4 (inferred renames) runs for every freshness: under a fresh lock it pairs only blocks
   * whose key and ident both changed, since a rename that kept either is matched by rules 1-2.
   */
  lockFreshness: LockFreshness
}

export interface MaterializeResult {
  state: WorkflowState
  /**
   * The CWM that was written: the input with renamed references rewritten and every matched
   * block's preserved state restored from prev (a param or subflow field that never executes,
   * a pair's stored member). Diff this, not the input, against the stored CWM to learn what a
   * write changes: an unchanged print differs from the stored CWM only in what this restores.
   */
  workflow: CanonicalWorkflow
  identity: LockIdentity
  entries: IdentityEntry[]
  /** New blocks with neither a prev nor a lock position, for targeted autolayout. */
  needsLayout: BlockKey[]
  diagnostics: Diagnostic<MaterializeDiagnosticCode>[]
}

/**
 * Writes a CWM back to a stored graph (DESIGN.md "Materialize"). With `prev`, every block, param, edge,
 * subflow and variable whose canonical form is unchanged keeps prev's stored bytes, so
 * `materialize(canonicalize(x), lock, { prev: x })` deep-equals `x` (O1). For every matched block:
 * - a param canonical-equal to prev's keeps prev's raw value; otherwise it takes prev's raw
 *   encoding when present, else the catalog `storage`;
 * - an edge whose `(from, port, to)` matches a prev edge reuses that whole prev edge object;
 * - a subflow config canonical-equal to prev's is written back verbatim, to both `block.data` and
 *   the loops/parallels map.
 * Server-owned fields come from prev by id.
 */
export function materialize(
  input: CanonicalWorkflow,
  lock: WorkflowLockV1 | null,
  options: MaterializeOptions
): MaterializeResult {
  const { catalog, hooks, prev } = options
  const diagnostics: Diagnostic<MaterializeDiagnosticCode>[] = []
  const prevCanonical = prev
    ? (options.prevCanonical ??
      canonicalize(prev, { catalog, meta: input.meta, lock, resources: options.resources }))
    : null

  const resolution = resolveIdentity({
    workflow: input,
    lock,
    prev: prev && prevCanonical ? { state: prev, canonical: prevCanonical } : null,
    catalog,
    hooks,
    freshness: options.lockFreshness,
    compiledIdents: options.compiledIdents,
    diagnostics,
  })
  const prevBlock = (prevKey: BlockKey | null) =>
    prevKey !== null && prevCanonical ? getOwn(prevCanonical.workflow.blocks, prevKey) : undefined
  // A restored inactive value names blocks by stored keys only, so it takes every rename at once
  // before restoring; a canvas rename rewrites every subBlock.
  const workflow = rewriteRenamedReferences(
    withPreservedState(
      input,
      (key) => {
        const stored = prevBlock(resolution.blocks.get(key)?.prevKey ?? null)
        return stored && rewriteStoredBlockReferences(stored, resolution.renames)
      },
      catalog
    ),
    resolution.renames
  )
  const idByKey = new Map([...resolution.blocks].map(([key, block]) => [key, block.id]))

  const keyByPrevKey = new Map<BlockKey, BlockKey>()
  for (const [key, block] of resolution.blocks) {
    if (block.prevKey !== null) keyByPrevKey.set(block.prevKey, key)
  }
  const { variables, idByKey: variableIdByKey } = writeVariables(
    workflow,
    lock,
    prev,
    prevCanonical,
    hooks,
    keyByPrevKey
  )
  const context: MaterializeContext = {
    catalog,
    hooks,
    resources: options.resources,
    diagnostics,
    variableIdByKey,
  }

  const lockById = new Map<string, WorkflowLockBlock>()
  for (const entry of Object.values(lock?.blocks ?? {})) lockById.set(entry.id, entry)
  const prevIdentity = prevCanonical?.identity.blocks ?? {}
  const parentIdOf = (parent: BlockKey | null, ids: (key: BlockKey) => string | undefined) =>
    parent !== null ? (ids(parent) ?? null) : null

  const blocks: Record<string, BlockState> = {}
  const built = new Map<BlockKey, BuiltBlock>()
  const needsLayout: BlockKey[] = []
  for (const [key, target] of Object.entries(workflow.blocks)) {
    const resolved = resolution.blocks.get(key)
    if (!resolved) continue
    const prevKey = resolved.prevKey
    const canonicalPrev = prevBlock(prevKey)
    const prevIdentityEntry = prevKey !== null ? getOwn(prevIdentity, prevKey) : undefined
    const storedPrev = prev ? getOwn(prev.blocks, resolved.id) : undefined
    const result = buildBlock(
      {
        key,
        target,
        resolved,
        parentId: parentIdOf(target.parent, (parent) => idByKey.get(parent)),
        prev:
          prevKey !== null && canonicalPrev && storedPrev
            ? {
                block: storedPrev,
                canonical: canonicalPrev,
                parentId: parentIdOf(
                  canonicalPrev.parent,
                  (parent) => getOwn(prevIdentity, parent)?.id
                ),
                branchIds: prevIdentityEntry?.branches,
                items: prevIdentityEntry?.items,
              }
            : undefined,
        lockBlock: lockById.get(resolved.id),
        layout: lock ? getOwn(lock.blocks, key)?.layout : undefined,
      },
      context
    )
    setOwn(blocks, resolved.id, result.block)
    built.set(key, result)
    if (result.needsLayout) {
      needsLayout.push(key)
      context.diagnostics.push(
        diagnostic(
          'I_MAT_NEEDS_LAYOUT',
          `Block "${key}" has no position in its container yet; it is placed by autolayout`,
          {
            blockKey: key,
          }
        )
      )
    }
  }

  const branchHandles = new Map<string, BranchHandles>()
  for (const [key, result] of built) {
    const id = idByKey.get(key)
    const kind = catalogBlock(catalog, workflow.blocks[key].type)?.graph.branches?.kind
    if (id === undefined || !kind || !result.branchIds) continue
    branchHandles.set(id, { kind, ids: result.branchIds })
  }
  const prevBranchHandles = new Map<string, BranchHandles>()
  for (const [key, identity] of Object.entries(prevIdentity)) {
    const prevType = prevBlock(key)?.type
    const kind = prevType && catalogBlock(catalog, prevType)?.graph.branches?.kind
    if (!kind || !identity.branches) continue
    prevBranchHandles.set(identity.id, { kind, ids: identity.branches })
  }

  const edges = writeEdges(
    {
      edges: workflow.edges,
      idByKey,
      blocks,
      branches: branchHandles,
      prevEdges: prev?.edges ?? [],
      prevBlocks: prev?.blocks ?? {},
      prevBranches: prevBranchHandles,
    },
    context
  )

  const errorSources = new Set(
    edges
      .filter(
        (edge) => normalizeWorkflowEdgeSourceHandle(edge.sourceHandle) === WORKFLOW_ERROR_HANDLE_ID
      )
      .map((edge) => edge.source)
  )
  for (const [key, target] of Object.entries(workflow.blocks)) {
    const id = idByKey.get(key)
    if (id === undefined) continue
    const block = getOwn(blocks, id)
    if (!block) continue
    const effective = Boolean(block.errorEnabled) || errorSources.has(id)
    if (effective !== target.errorPort) {
      setOwn(blocks, id, { ...block, errorEnabled: target.errorPort })
    }
  }

  const loops: Record<string, Loop> = {}
  const parallels: Record<string, Parallel> = {}
  for (const [id, entry] of Object.entries(prev?.loops ?? {})) {
    if (!Object.hasOwn(prev?.blocks ?? {}, id)) setOwn(loops, id, entry)
  }
  for (const [id, entry] of Object.entries(prev?.parallels ?? {})) {
    if (!Object.hasOwn(prev?.blocks ?? {}, id)) setOwn(parallels, id, entry)
  }
  const childrenOf = childrenByParent(blocks)
  const prevChildrenOf = childrenByParent(prev?.blocks ?? {})
  for (const [key, target] of Object.entries(workflow.blocks)) {
    const id = idByKey.get(key)
    const resolved = resolution.blocks.get(key)
    const block = id !== undefined ? getOwn(blocks, id) : undefined
    if (id === undefined || !block || !resolved || !target.subflow) continue
    const before = prevBlock(resolved.prevKey)
    const context = {
      id,
      block,
      nodes: childrenOf.get(id) ?? [],
      specChanged: !before || !deepEqual(before.subflow, target.subflow),
      enabledChanged: before !== undefined && before.enabled !== target.enabled,
      lockedChanged: before !== undefined && before.locked !== target.locked,
      matched: before !== undefined,
      prevNodes: before && prev ? (prevChildrenOf.get(id) ?? []) : [],
    }
    const fromPrev = before !== undefined && prev !== undefined
    if (target.subflow.kind === 'loop') {
      const prevEntry = fromPrev ? getOwn(prev.loops ?? {}, id) : undefined
      const entry = loopEntry(context, target.subflow, prevEntry)
      if (entry) setOwn(loops, id, entry)
    } else {
      const prevEntry = fromPrev ? getOwn(prev.parallels ?? {}, id) : undefined
      const entry = parallelEntry(context, target.subflow, prevEntry)
      if (entry) setOwn(parallels, id, entry)
    }
  }

  const state: WorkflowState = { ...prev, blocks, edges, loops, parallels }
  if (Object.keys(variables).length > 0 || prev?.variables !== undefined) {
    state.variables = variables
  }

  const identity: LockIdentity = { blocks: {}, variables: Object.fromEntries(variableIdByKey) }
  for (const [key, target] of Object.entries(workflow.blocks)) {
    const result = built.get(key)
    const id = idByKey.get(key)
    if (!result || id === undefined) continue
    const entry: LockIdentityBlock = { id, parent: target.parent }
    if (result.branchIds && Object.keys(result.branchIds).length > 0) {
      entry.branches = result.branchIds
    }
    if (Object.keys(result.items).length > 0) entry.items = result.items
    setOwn(identity.blocks, key, entry)
  }

  return {
    state,
    workflow,
    identity,
    entries: [
      ...[...resolution.blocks.values()].map((block) => block.entry),
      ...resolution.deleted,
    ],
    needsLayout,
    diagnostics,
  }
}
