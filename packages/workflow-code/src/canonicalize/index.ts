import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  type BlockRetryConfig,
  type BlockState,
  isSubflowType,
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
  resolveEffectiveErrorEnabled,
  type WorkflowState,
} from '@sim/workflow-types/workflow'
import type { BlockCatalog } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type { CanonicalizeDiagnosticCode } from '../diagnostics/codes'
import { diagnostic } from '../diagnostics/factory'
import type { Diagnostic } from '../diagnostics/frame'
import { BLOCK_LAYOUT_DATA_FIELDS, layoutOf } from '../layout'
import type { LockIdentity, LockIdentityBlock, LockLayout } from '../lock'
import type {
  BlockKey,
  BranchKey,
  CanonicalBlock,
  CanonicalVariable,
  CanonicalWorkflow,
  CanonicalWorkflowMeta,
  Json,
  ResourceKeyResolver,
  VarKey,
} from '../model'
import { setOwn } from '../records'
import { type LiftedBranches, liftBranches } from './branches'
import type { CanonContext } from './context'
import { canonicalEdges } from './edges'
import { assignBlockKeys, assignVariableKeys } from './keys'
import { effectiveModes, isModeMap, parseModeMap } from './modes'
import { canonicalParams } from './params'
import { loopSpec, parallelSpec, SUBFLOW_DATA_KEYS } from './subflows'
import { toJson, toValue } from './values'

/** `block.data` keys the lock layout owns; with the model's own keys, the rest is `extra`. */
const LAYOUT_DATA_KEYS: ReadonlySet<string> = new Set(BLOCK_LAYOUT_DATA_FIELDS)

/**
 * The stored retry policy, with its numbers pinned the way the loader pins them
 * (`normalizeStoredBlockRetry` in workflow-persistence), so it reads the same whether or not it
 * went through a load; numbers are kept when it is disabled (`BlockRetryConfig`). Compile refuses
 * an out-of-range policy, so every printed one compiles back unchanged.
 */
function canonicalRetry(retry: unknown): BlockRetryConfig | null {
  if (retry === undefined || retry === null) return null
  const record = toRecord(retry)
  return {
    enabled: record.enabled === true,
    maxTries: normalizeBlockRetryTries(record.maxTries),
    waitBetweenTriesMs: normalizeBlockRetryWaitMs(record.waitBetweenTriesMs),
  }
}

/** Lock branch keys by block id, then row id → key; a later entry for an id wins. */
function lockBranchKeysById(
  lock: CanonicalizeOptions['lock']
): Map<string, Map<string, BranchKey>> {
  const result = new Map<string, Map<string, BranchKey>>()
  for (const entry of Object.values(lock?.blocks ?? {})) {
    if (!entry.branches) continue
    const byRow = new Map<string, BranchKey>()
    for (const [key, rowId] of Object.entries(entry.branches)) byRow.set(rowId, key)
    result.set(entry.id, byRow)
  }
  return result
}

/** Inputs to `canonicalize`. */
export interface CanonicalizeOptions {
  catalog: BlockCatalog
  /** The workflow row's name and description, which `WorkflowState` does not carry. */
  meta: CanonicalWorkflowMeta
  /** Supplies branch keys by block id and row id; never changes block keys. */
  lock?: Pick<LockIdentity, 'blocks'> | null
  resources?: ResourceKeyResolver
}

/** The canonical workflow with its key-to-id identity, stored layout and diagnostics. */
export interface CanonicalizeResult {
  workflow: CanonicalWorkflow
  /** Key → id for every block, branch, item and variable in `workflow`. */
  identity: LockIdentity
  /** Stored positions by key, for the lock. Not part of the CWM. */
  layout: Record<BlockKey, LockLayout>
  diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[]
}

/**
 * Projects a stored, already-migrated graph to the CWM. Pure and total: problems become diagnostics.
 */
export function canonicalize(
  state: WorkflowState,
  options: CanonicalizeOptions
): CanonicalizeResult {
  const diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[] = []
  const blocks: Record<string, BlockState> = state.blocks ?? {}
  const { keyById, referenceableKeys } = assignBlockKeys(blocks, diagnostics)
  const variableEntries = assignVariableKeys(state.variables ?? {}, diagnostics)
  const context: CanonContext = {
    catalog: options.catalog,
    resources: options.resources,
    diagnostics,
    keyById,
    referenceableKeys,
    variables: variableEntries,
    variableKeyById: new Map(variableEntries.map((entry) => [entry.id, entry.key])),
  }
  const lockBranchKeys = lockBranchKeysById(options.lock)

  const liftedBranches = new Map<string, LiftedBranches>()
  for (const [id, block] of Object.entries(blocks)) {
    const branchSpec = catalogBlock(context.catalog, block.type)?.graph.branches
    if (!branchSpec) continue
    const key = keyById.get(id) ?? id
    liftedBranches.set(
      id,
      liftBranches(
        branchSpec.kind,
        id,
        key,
        branchSpec.subBlockId,
        block.subBlocks?.[branchSpec.subBlockId]?.value,
        lockBranchKeys.get(id) ?? new Map(),
        context
      )
    )
  }

  const { edges, errorSourceIds } = canonicalEdges(
    state.edges ?? [],
    {
      blocks,
      branchKeys: new Map(
        [...liftedBranches].map(([id, lifted]) => [
          id,
          { kind: lifted.branches.kind, keyByRowId: lifted.keyByRowId },
        ])
      ),
    },
    context
  )

  const canonicalBlocks: Record<BlockKey, CanonicalBlock> = {}
  const identity: LockIdentity = { blocks: {}, variables: {} }
  const layout: Record<BlockKey, LockLayout> = {}

  for (const [id, block] of Object.entries(blocks)) {
    const key = keyById.get(id) ?? id
    const data: Record<string, unknown> = { ...block.data }
    const catalog = catalogBlock(context.catalog, block.type)
    const isContainer = isSubflowType(block.type)
    if (!catalog && !isContainer) {
      context.diagnostics.push(
        diagnostic(
          'W_CANON_UNKNOWN_BLOCK_TYPE',
          `Block type "${block.type}" is not in the catalog; params kept verbatim`,
          {
            blockKey: key,
          }
        )
      )
    }

    const extraFields: Record<string, Json> = {}
    const parentId = typeof data.parentId === 'string' ? data.parentId : undefined
    const parent = parentId !== undefined ? (keyById.get(parentId) ?? null) : null
    if (data.parentId != null && (parentId === undefined || parent === null)) {
      extraFields.parentId = toJson(data.parentId)
      context.diagnostics.push(
        diagnostic(
          'W_CANON_DANGLING_PARENT',
          `Block "${key}" names parent "${String(data.parentId)}", which is not a block; placed at the root`,
          {
            blockKey: key,
          }
        )
      )
    }

    const overrides = parseModeMap(data.canonicalModes)
    const lifted = liftedBranches.get(id)
    const { params, items } = canonicalParams(
      {
        blockKey: key,
        block,
        catalog,
        overrides,
        branchSubBlockId: lifted ? catalog?.graph.branches?.subBlockId : undefined,
      },
      context
    )
    if (lifted && 'unliftedValue' in lifted && catalog?.graph.branches) {
      setOwn(params, catalog.graph.branches.subBlockId, {
        kind: 'value',
        value: toValue(lifted.unliftedValue, context),
      })
    }

    const advancedMode = block.advancedMode === true
    const triggerMode = block.triggerMode === true
    const rawValues: Record<string, unknown> = {}
    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks ?? {})) {
      setOwn(rawValues, subBlockId, isRecordLike(subBlock) ? subBlock.value : undefined)
    }

    const canonical: CanonicalBlock = {
      key,
      name: block.name,
      type: block.type,
      parent,
      enabled: block.enabled !== false,
      locked: block.locked === true,
      triggerMode,
      advancedMode,
      errorPort: resolveEffectiveErrorEnabled(block, id, errorSourceIds),
      retry: canonicalRetry(block.retry),
      params,
      modes:
        catalog && !isContainer
          ? effectiveModes(catalog, triggerMode, rawValues, overrides, advancedMode)
          : {},
    }
    if (lifted) canonical.branches = lifted.branches

    const rejectedDataKeys = new Set<string>()
    if (block.type === 'loop') {
      const result = loopSpec(block, state.loops?.[id], key, context)
      canonical.subflow = result.spec
      for (const dataKey of result.rejectedDataKeys) rejectedDataKeys.add(dataKey)
    } else if (block.type === 'parallel') {
      const result = parallelSpec(block, state.parallels?.[id], key, context)
      canonical.subflow = result.spec
      for (const dataKey of result.rejectedDataKeys) rejectedDataKeys.add(dataKey)
    }

    for (const [dataKey, value] of Object.entries(data)) {
      if (value === undefined || dataKey === 'parentId') continue
      if (LAYOUT_DATA_KEYS.has(dataKey) && typeof value === 'number') continue
      if (dataKey === 'extent' && value === 'parent' && parent !== null) continue
      if (dataKey === 'canonicalModes' && isModeMap(value)) continue
      if (isContainer && SUBFLOW_DATA_KEYS.has(dataKey) && !rejectedDataKeys.has(dataKey)) continue
      setOwn(extraFields, dataKey, toJson(value))
    }
    if (Object.keys(extraFields).length > 0) canonical.extra = extraFields

    setOwn(canonicalBlocks, key, canonical)
    const identityBlock: LockIdentityBlock = { id, parent }
    if (lifted && Object.keys(lifted.ids).length > 0) identityBlock.branches = lifted.ids
    if (Object.keys(items).length > 0) identityBlock.items = items
    setOwn(identity.blocks, key, identityBlock)
    setOwn(layout, key, layoutOf(block))
  }

  const variables: Record<VarKey, CanonicalVariable> = {}
  const storedVariables = Object.values(state.variables ?? {})
  variableEntries.forEach((entry, index) => {
    const variable = storedVariables[index]
    setOwn(variables, entry.key, {
      key: entry.key,
      name: variable.name,
      type: variable.type,
      value: toJson(variable.value),
    })
    setOwn(identity.variables, entry.key, entry.id)
  })

  const workflow: CanonicalWorkflow = {
    modelVersion: 1,
    meta: { name: options.meta.name, description: options.meta.description },
    blocks: canonicalBlocks,
    edges,
    variables,
    annotations: { comments: {} },
  }
  return { workflow, identity, layout, diagnostics }
}

/**
 * Whether canonicalizing with `lock` gives exactly `lockless` (the same state canonicalized with
 * no lock). A row the lock keys must already have that key; a row it does not key keeps its
 * lockless key, because the keys the lock pre-assigns are other rows' own lockless keys and so
 * never displace one.
 */
function lockKeepsCanonical(lock: CanonicalizeOptions['lock'], lockless: LockIdentity): boolean {
  const lockKeysById = lockBranchKeysById(lock)
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
 * `state` canonicalized with `lock`, reusing `lockless` (the same state and options with no lock)
 * when the lock changes nothing, which is the common case: the lock only supplies branch keys.
 */
export function canonicalizeUnderLock(
  state: WorkflowState,
  options: Omit<CanonicalizeOptions, 'lock'>,
  lockless: CanonicalizeResult,
  lock: CanonicalizeOptions['lock']
): CanonicalizeResult {
  if (lockKeepsCanonical(lock, lockless.identity)) return lockless
  return canonicalize(state, { ...options, lock })
}
