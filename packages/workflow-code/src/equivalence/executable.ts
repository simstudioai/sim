/**
 * The executable projection of a CWM (wave 4 governing principle: source holds what executes).
 * Everything the canvas keeps only for itself is stripped, so two workflows that run the same are
 * equal here even when their preserved UI state differs:
 * - inactive values (stored, never sent: `isInactive` over the CWM, the same rule the printer and
 *   materialize use);
 * - which member of a basic/advanced pair holds the value, and the mode that picks it: the
 *   serializer sends the effective member's value under the canonical id, so a pair projects to
 *   one param keyed by its `canonicalParamId`;
 * - the config fields of the loop or parallel types not in effect, and storage spellings the
 *   runtime reads alike (`count: 0` and an absent count both run 5 iterations);
 * - unknown `block.data` residue, which nothing executes (a container keeps the subflow keys it
 *   could not read, because the serializer passes a container's `data` through).
 *
 * P0/P1 compare this view; O1 still compares stored bytes.
 */

import { compareEdges } from '../canonicalize/edges'
import { SUBFLOW_DATA_KEYS } from '../canonicalize/subflows'
import { executableInactiveParams } from '../catalog/activity'
import { isCanonicalPair } from '../catalog/canonical-index'
import { buildCanonicalIndexForSurface } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type {
  BlockKey,
  CanonicalBlock,
  CanonicalBranches,
  CanonicalEdge,
  CanonicalParam,
  CanonicalVariable,
  CanonicalWorkflow,
  CanonicalWorkflowMeta,
  Json,
  LoopSpec,
  ParallelSpec,
  VarKey,
} from '../model'
import { setOwn } from '../records'

/** `count || 5` in `convertLoopBlockToLoop` and the loop orchestrator. */
const DEFAULT_LOOP_ITERATIONS = 5
/** `data.count || 5` in `convertParallelBlockToParallel`. */
const DEFAULT_PARALLEL_COUNT = 5
const PARALLEL_BATCH_MAX = 20

/** A loop or parallel config exactly as the executor reads it for the type in effect. */
export type ExecutableSubflow =
  | {
      kind: 'loop'
      loopType: LoopSpec['loopType']
      iterations?: number
      forEachItems?: Json
      whileCondition?: string
      doWhileCondition?: string
    }
  | {
      kind: 'parallel'
      parallelType: 'count' | 'collection'
      count?: number
      distribution?: Json
      batchSize: number
    }

export interface ExecutableBlock {
  key: BlockKey
  name: string
  type: string
  parent: BlockKey | null
  enabled: boolean
  locked: boolean
  triggerMode: boolean
  advancedMode: boolean
  errorPort: boolean
  retry: CanonicalBlock['retry']
  /** Active params; a basic/advanced pair is one param under its canonical id. */
  params: Record<string, CanonicalParam>
  branches?: CanonicalBranches
  subflow?: ExecutableSubflow
  /** Container `data` keys canonicalize could not read as config; the serializer passes them on. */
  subflowResidue?: Record<string, Json>
}

export interface ExecutableWorkflow {
  meta: CanonicalWorkflowMeta
  blocks: Record<BlockKey, ExecutableBlock>
  edges: CanonicalEdge[]
  variables: Record<VarKey, CanonicalVariable>
}

function executableLoop(spec: LoopSpec): ExecutableSubflow {
  const iterations = spec.iterations || DEFAULT_LOOP_ITERATIONS
  switch (spec.loopType) {
    case 'for':
      return { kind: 'loop', loopType: 'for', iterations }
    case 'forEach':
      return { kind: 'loop', loopType: 'forEach', forEachItems: spec.forEachItems || '' }
    case 'while':
      return { kind: 'loop', loopType: 'while', whileCondition: spec.whileCondition || '' }
    case 'doWhile': {
      const doWhileCondition = spec.doWhileCondition || ''
      return doWhileCondition === ''
        ? { kind: 'loop', loopType: 'doWhile', doWhileCondition, iterations }
        : { kind: 'loop', loopType: 'doWhile', doWhileCondition }
    }
  }
}

/** `clampParallelBatchSize`: a missing or non-numeric size is 20, anything else 1–20. */
function clampBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined || Number.isNaN(batchSize)) return PARALLEL_BATCH_MAX
  return Math.max(1, Math.min(PARALLEL_BATCH_MAX, Math.trunc(batchSize)))
}

function executableParallel(spec: ParallelSpec): ExecutableSubflow {
  const parallelType = spec.parallelType ?? 'count'
  const batchSize = clampBatchSize(spec.batchSize)
  return parallelType === 'count'
    ? {
        kind: 'parallel',
        parallelType,
        count: spec.count || DEFAULT_PARALLEL_COUNT,
        batchSize,
      }
    : { kind: 'parallel', parallelType, distribution: spec.distribution || '', batchSize }
}

/** A loop or parallel config as the executor reads it for the type in effect. */
export function executableSubflow(spec: LoopSpec | ParallelSpec): ExecutableSubflow {
  return spec.kind === 'loop' ? executableLoop(spec) : executableParallel(spec)
}

/** The executable form of one block's params: inactive values dropped, pairs keyed by id. */
function executableParams(
  block: CanonicalBlock,
  declared: CatalogBlock | undefined,
  catalog: BlockCatalog
): Record<string, CanonicalParam> {
  if (!declared) return { ...block.params }
  const inactive = new Set(executableInactiveParams(block, catalog))
  const params: Record<string, CanonicalParam> = {}
  for (const [id, param] of Object.entries(block.params)) {
    if (!inactive.has(id)) setOwn(params, id, param)
  }
  const index = buildCanonicalIndexForSurface(declared, block.triggerMode)
  for (const group of Object.values(index.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const members = [group.basicId, ...group.advancedIds].filter(
      (id): id is string => id !== undefined && Object.hasOwn(params, id)
    )
    if (members.length !== 1) continue
    const [member] = members
    const value = params[member]
    delete params[member]
    setOwn(params, group.canonicalId, value)
  }
  return params
}

function executableBlock(block: CanonicalBlock, catalog: BlockCatalog): ExecutableBlock {
  const declared = block.subflow ? undefined : catalogBlock(catalog, block.type)
  const view: ExecutableBlock = {
    key: block.key,
    name: block.name,
    type: block.type,
    parent: block.parent,
    enabled: block.enabled,
    locked: block.locked,
    triggerMode: block.triggerMode,
    advancedMode: block.advancedMode,
    errorPort: block.errorPort,
    retry: block.retry,
    params: executableParams(block, declared, catalog),
  }
  if (block.branches) view.branches = block.branches
  if (block.subflow) {
    view.subflow = executableSubflow(block.subflow)
    const residue: Record<string, Json> = {}
    for (const [key, value] of Object.entries(block.extra ?? {})) {
      if (SUBFLOW_DATA_KEYS.has(key)) setOwn(residue, key, value)
    }
    if (Object.keys(residue).length > 0) view.subflowResidue = residue
  }
  return view
}

/** The executable projection of `workflow` (see the module comment). */
export function executableView(
  workflow: CanonicalWorkflow,
  catalog: BlockCatalog
): ExecutableWorkflow {
  const blocks: Record<BlockKey, ExecutableBlock> = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    setOwn(blocks, key, executableBlock(block, catalog))
  }
  return {
    meta: workflow.meta,
    blocks,
    edges: [...workflow.edges].sort(compareEdges),
    variables: workflow.variables,
  }
}
