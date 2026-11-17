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
import type { Diagnostic } from '../diagnostics/frame'
import type { LockIdentity, WorkflowLockBlock, WorkflowLockV1 } from '../lock'
import type {
  BlockKey,
  CanonicalBlock,
  CanonicalWorkflow,
  ResourceKeyResolver,
  VarKey,
} from '../model'
import { deepEqual, invertRecord, setOwn } from '../records'
import { type BuiltBlock, buildBlock } from './block'
import { type MaterializeContext, type MaterializeHooks, report } from './context'
import { type BranchHandles, writeEdges } from './edges'
import { type IdentityEntry, type LockFreshness, resolveIdentity } from './identity'
import { restorePreserved } from './preserve'
import { subflowEntry } from './subflows'
import { rewriteRenamedReferences } from './values'

/**
 * Variables keep their ids by key: the lock's id, then prev's, else a new one. A variable
 * canonical-equal to the prev variable with that id is prev's stored object unchanged.
 */
function writeVariables(
  workflow: CanonicalWorkflow,
  lock: WorkflowLockV1 | null,
  prev: WorkflowState | undefined,
  prevCanonical: CanonicalizeResult | null,
  hooks: MaterializeHooks
): { variables: Record<string, Variable>; idByKey: Map<VarKey, string> } {
  const prevVariables = prev?.variables ?? {}
  const prevKeyById = invertRecord(prevCanonical?.identity.variables ?? {})
  const lockIds = lock?.variables ?? {}
  const lockIdCounts = new Map<string, number>()
  for (const id of Object.values(lockIds)) lockIdCounts.set(id, (lockIdCounts.get(id) ?? 0) + 1)

  const used = new Set<string>()
  const variables: Record<string, Variable> = {}
  const idByKey = new Map<VarKey, string>()
  for (const [key, variable] of Object.entries(workflow.variables)) {
    const fromLock = lockIds[key]
    const candidates = [
      fromLock !== undefined && lockIdCounts.get(fromLock) === 1 ? fromLock : undefined,
      prevCanonical?.identity.variables[key],
    ]
    const id =
      candidates.find(
        (candidate): candidate is string =>
          candidate !== undefined &&
          !used.has(candidate) &&
          (!Object.hasOwn(prevVariables, candidate) || prevKeyById.get(candidate) === key)
      ) ?? hooks.newId()
    used.add(id)
    idByKey.set(key, id)
    const stored = Object.hasOwn(prevVariables, id) ? prevVariables[id] : undefined
    const prevKey = prevKeyById.get(id)
    const before = prevKey !== undefined ? prevCanonical?.workflow.variables[prevKey] : undefined
    const unchanged =
      stored !== undefined &&
      before !== undefined &&
      before.name === variable.name &&
      before.type === variable.type &&
      deepEqual(before.value, variable.value)
    variables[id] = unchanged
      ? stored
      : { ...stored, id, name: variable.name, type: variable.type, value: variable.value }
  }
  return { variables, idByKey }
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

function childIds(blocks: Record<string, BlockState>, containerId: string): string[] {
  return Object.entries(blocks)
    .filter(([, block]) => block.data?.parentId === containerId)
    .map(([id]) => id)
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
  /** Disables identity rule 4 (inferred renames); no surface sets it, tests and tools only. */
  inferRenames?: boolean
  /**
   * Idents as written in the compiled file (`CompileResult.hints`), by block key. Identity
   * rule 2 matches a lock entry whose key is gone by its ident, so a human who edits only the
   * display string keeps the block's id.
   */
  compiledIdents?: Record<BlockKey, string>
  /**
   * How the lock relates to `prev`: `fresh` when its base fingerprint matches the stored graph,
   * `stale` when it does not, `none` when there is no lock. A `stale` lock entry whose id left
   * prev is re-created with `W_MAT_DELETED_SINCE_PULL`. Rule 4 (inferred renames) runs for every
   * freshness: under a fresh lock it pairs only blocks whose key and ident both changed, since a
   * rename that kept either is matched by rules 1-2.
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
    inferRenames: options.inferRenames !== false,
    diagnostics,
  })
  // Rewrite after restoring: a restored inactive value can hold `<oldkey.` too, and a canvas
  // rename rewrites every subBlock.
  const workflow = rewriteRenamedReferences(
    withPreservedState(
      input,
      (key) => {
        const prevKey = resolution.blocks.get(key)?.prevKey ?? null
        return prevKey !== null ? prevCanonical?.workflow.blocks[prevKey] : undefined
      },
      catalog
    ),
    resolution.renames
  )
  const idByKey = new Map([...resolution.blocks].map(([key, block]) => [key, block.id]))

  const { variables, idByKey: variableIdByKey } = writeVariables(
    workflow,
    lock,
    prev,
    prevCanonical,
    hooks
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
    const canonicalPrev = prevKey !== null ? prevCanonical?.workflow.blocks[prevKey] : undefined
    const storedPrev = prev?.blocks[resolved.id]
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
                parentId: parentIdOf(canonicalPrev.parent, (parent) => prevIdentity[parent]?.id),
                branchIds: prevIdentity[prevKey]?.branches,
                items: prevIdentity[prevKey]?.items,
              }
            : undefined,
        lockBlock: lockById.get(resolved.id),
        layout: lock?.blocks[key]?.layout,
      },
      context
    )
    blocks[resolved.id] = result.block
    built.set(key, result)
    if (result.needsLayout) {
      needsLayout.push(key)
      report(context, {
        code: 'I_MAT_NEEDS_LAYOUT',
        severity: 'info',
        message: `Block "${key}" has no stored or lock position; it is placed by autolayout`,
        blockKey: key,
      })
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
    const prevType = prevCanonical?.workflow.blocks[key]?.type
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
    const block = blocks[id]
    const effective = Boolean(block.errorEnabled) || errorSources.has(id)
    if (effective !== target.errorPort) blocks[id] = { ...block, errorEnabled: target.errorPort }
  }

  const loops: Record<string, Loop> = {}
  const parallels: Record<string, Parallel> = {}
  for (const [id, entry] of Object.entries(prev?.loops ?? {})) {
    if (!Object.hasOwn(prev?.blocks ?? {}, id)) loops[id] = entry
  }
  for (const [id, entry] of Object.entries(prev?.parallels ?? {})) {
    if (!Object.hasOwn(prev?.blocks ?? {}, id)) parallels[id] = entry
  }
  for (const [key, target] of Object.entries(workflow.blocks)) {
    const id = idByKey.get(key)
    const resolved = resolution.blocks.get(key)
    if (id === undefined || !resolved || !target.subflow) continue
    const before =
      resolved.prevKey !== null ? prevCanonical?.workflow.blocks[resolved.prevKey] : undefined
    const prevEntry =
      before && prev
        ? target.subflow.kind === 'loop'
          ? prev.loops?.[id]
          : prev.parallels?.[id]
        : undefined
    const entry = subflowEntry({
      id,
      block: blocks[id],
      spec: target.subflow,
      nodes: childIds(blocks, id),
      prevEntry,
      specChanged: !before || !deepEqual(before.subflow, target.subflow),
      enabledChanged: before !== undefined && before.enabled !== target.enabled,
      lockedChanged: before !== undefined && before.locked !== target.locked,
      matched: before !== undefined,
      prevNodes: before && prev ? childIds(prev.blocks, id) : [],
    })
    if (!entry) continue
    if (target.subflow.kind === 'loop') loops[id] = entry as Loop
    else parallels[id] = entry as Parallel
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
    identity.blocks[key] = { id, parent: target.parent }
    if (result.branchIds && Object.keys(result.branchIds).length > 0) {
      identity.blocks[key].branches = result.branchIds
    }
    if (Object.keys(result.items).length > 0) identity.blocks[key].items = result.items
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
