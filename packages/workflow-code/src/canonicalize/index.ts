import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  type BlockRetryConfig,
  type BlockState,
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
  resolveEffectiveErrorEnabled,
} from '@sim/workflow-types/workflow'
import type { CanonicalizeFn } from '../api'
import { deployReadIds, isInactive } from '../catalog/activity'
import type { CanonicalModeOverrides } from '../catalog/canonical-index'
import { buildCanonicalIndexForSurface } from '../catalog/surface'
import type { CanonicalizeDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { LockIdentity, LockIdentityBlock, LockLayout } from '../lock'
import type {
  BlockKey,
  BranchKey,
  CanonicalBlock,
  CanonicalVariable,
  CanonicalWorkflow,
  Json,
  SubBlockId,
  VarKey,
} from '../model'
import { setOwn } from '../records'
import { type LiftedBranches, liftBranches } from './branches'
import { type CanonContext, catalogBlock, report } from './context'
import { canonicalEdges } from './edges'
import { assignBlockKeys, assignVariableKeys } from './keys'
import { effectiveModes } from './modes'
import { canonicalParams } from './params'
import { loopSpec, parallelSpec, SUBFLOW_DATA_KEYS } from './subflows'
import { toJson, toValue } from './values'

/** `block.data` keys the model or the lock layout owns; anything else is kept under `extra`. */
const LAYOUT_DATA_KEYS = new Set(['width', 'height'])
const MODES = new Set(['basic', 'advanced'])

function isRetryConfig(value: unknown): value is BlockRetryConfig {
  return (
    isRecordLike(value) &&
    typeof value.enabled === 'boolean' &&
    typeof value.maxTries === 'number' &&
    typeof value.waitBetweenTriesMs === 'number' &&
    Object.keys(value).length === 3
  )
}

/**
 * The stored retry policy, raw: numbers are kept when it is disabled (workflow.ts:87-101). A
 * malformed policy is normalized the way every reader clamps it.
 */
function canonicalRetry(retry: unknown): BlockRetryConfig | null {
  if (retry === undefined || retry === null) return null
  if (isRetryConfig(retry)) return { ...retry }
  const record = toRecord(retry)
  return {
    enabled: record.enabled === true,
    maxTries: normalizeBlockRetryTries(record.maxTries),
    waitBetweenTriesMs: normalizeBlockRetryWaitMs(record.waitBetweenTriesMs),
  }
}

function canonicalModeOverrides(data: Record<string, unknown>): CanonicalModeOverrides | undefined {
  const stored = data.canonicalModes
  if (!isRecordLike(stored)) return undefined
  const overrides: CanonicalModeOverrides = {}
  for (const [id, mode] of Object.entries(stored)) {
    if (typeof mode === 'string' && MODES.has(mode))
      setOwn(overrides, id, mode as 'basic' | 'advanced')
  }
  return overrides
}

function isModeMap(value: unknown): boolean {
  return (
    isRecordLike(value) &&
    Object.values(value).every((mode) => typeof mode === 'string' && MODES.has(mode))
  )
}

function layoutOf(block: BlockState): LockLayout {
  const layout: LockLayout = { x: block.position?.x ?? 0, y: block.position?.y ?? 0 }
  const data = block.data ?? {}
  if (typeof data.width === 'number') layout.w = data.width
  if (typeof data.height === 'number') layout.h = data.height
  if (typeof block.height === 'number') layout.height = block.height
  if (typeof block.horizontalHandles === 'boolean')
    layout.horizontalHandles = block.horizontalHandles
  return layout
}

/** Lock branch keys by block id, then row id → key (build-spec decision 5). */
function lockBranchKeysById(
  lock: Parameters<CanonicalizeFn>[1]['lock']
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

/**
 * Projects a stored, already-migrated graph to the CWM (s1 §2 canonicalize steps 1–9; quirk
 * numbers refer to s1 §5). Pure and total: problems become diagnostics.
 */
export const canonicalize: CanonicalizeFn = (state, options) => {
  const diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[] = []
  const blocks: Record<string, BlockState> = state.blocks ?? {}
  const { keyById, referenceKeyByName } = assignBlockKeys(blocks, diagnostics)
  const variableEntries = assignVariableKeys(state.variables ?? {}, diagnostics)
  const context: CanonContext = {
    catalog: options.catalog,
    resources: options.resources,
    diagnostics,
    keyById,
    referenceKeyByName,
    variables: variableEntries,
    variableKeyById: new Map(variableEntries.map((entry) => [entry.id, entry.key])),
  }
  const lockBranchKeys = lockBranchKeysById(options.lock)

  const liftedBranches = new Map<string, LiftedBranches>()
  for (const [id, block] of Object.entries(blocks)) {
    const branchSpec = catalogBlock(context, block.type)?.graph.branches
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
  const inactive: Record<BlockKey, SubBlockId[]> = {}

  for (const [id, block] of Object.entries(blocks)) {
    const key = keyById.get(id) ?? id
    const data: Record<string, unknown> = { ...block.data }
    const catalog = catalogBlock(context, block.type)
    const isContainer = block.type === 'loop' || block.type === 'parallel'
    if (!catalog && !isContainer) {
      report(context, {
        code: 'W_CANON_UNKNOWN_BLOCK_TYPE',
        severity: 'warning',
        message: `Block type "${block.type}" is not in the catalog; params kept verbatim`,
        blockKey: key,
      })
    }

    const extraFields: Record<string, Json> = {}
    const parentId = typeof data.parentId === 'string' ? data.parentId : undefined
    const parent = parentId !== undefined ? (keyById.get(parentId) ?? null) : null
    if (data.parentId != null && (parentId === undefined || parent === null)) {
      extraFields.parentId = toJson(data.parentId)
      report(context, {
        code: 'W_CANON_DANGLING_PARENT',
        severity: 'warning',
        message: `Block "${key}" names parent "${String(data.parentId)}", which is not a block; placed at the root`,
        blockKey: key,
      })
    }

    const overrides = canonicalModeOverrides(data)
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

    if (catalog && !isContainer) {
      const activityValues = overrides ? { ...rawValues, __canonicalModes: overrides } : rawValues
      const activityInputs = {
        block: catalog,
        blockType: block.type,
        triggerMode,
        advancedMode,
        values: activityValues,
        overrides,
        index: buildCanonicalIndexForSurface(catalog, triggerMode),
        deployRead: deployReadIds(options.catalog, catalog, block.type, triggerMode, rawValues),
      }
      const inactiveIds = Object.keys(params).filter((paramId) =>
        isInactive(paramId, activityInputs)
      )
      if (inactiveIds.length > 0) setOwn(inactive, key, inactiveIds)
    }

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
    annotations: { inactive, comments: {} },
  }
  return { workflow, identity, layout, diagnostics }
}
