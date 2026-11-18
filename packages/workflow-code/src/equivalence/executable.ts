/**
 * The executable projection of a CWM (DESIGN.md "The executable view").
 * Everything the canvas keeps only for itself is stripped, so two workflows that run the same are
 * equal here even when their preserved UI state differs:
 * - inactive values (stored, never sent: `isInactive` over the CWM, the same rule the printer and
 *   materialize use);
 * - which member of a basic/advanced pair holds the value, and the mode that picks it: the
 *   serializer sends the effective member's value under the canonical id, so a pair projects to
 *   one param keyed by its `canonicalParamId`;
 * - the config fields of the loop or parallel types not in effect, and storage spellings the
 *   runtime reads alike (`count: 0` and an absent count both run 5 iterations);
 * - unknown `block.data` extra data, which nothing executes (a container keeps the subflow keys it
 *   could not read, because the serializer passes a container's `data` through).
 *
 * P0/P1 compare this view; O1 still compares stored bytes.
 */

import { compareEdges } from '../canonicalize/edges'
import {
  DEFAULT_LOOP_ITERATIONS,
  effectiveBatchSize,
  SUBFLOW_DATA_KEYS,
} from '../canonicalize/subflows'
import { executableInactiveParams } from '../catalog/activity'
import { isCanonicalPair } from '../catalog/canonical-index'
import { serializedCanonicalIndex } from '../catalog/surface'
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
  LoopType,
  ParallelSpec,
  ParallelType,
  VarKey,
} from '../model'
import { setOwn } from '../records'

/** `data.count || 5` in `convertParallelBlockToParallel`. */
const DEFAULT_PARALLEL_COUNT = 5

/** A loop or parallel config exactly as the executor reads it for the type in effect. */
type ExecutableSubflow =
  | {
      kind: 'loop'
      loopType: LoopType
      iterations?: number
      forEachItems?: Json
      whileCondition?: string
      doWhileCondition?: string
    }
  | {
      kind: 'parallel'
      parallelType: ParallelType
      count?: number
      distribution?: Json
      batchSize: number
    }

interface ExecutableBlock {
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
  subflowData?: Record<string, Json>
}

interface ExecutableWorkflow {
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

function executableParallel(spec: ParallelSpec): ExecutableSubflow {
  const parallelType = spec.parallelType ?? 'count'
  const batchSize = effectiveBatchSize(spec.batchSize)
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
  const index = serializedCanonicalIndex(declared, block.triggerMode)
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
    const extra: Record<string, Json> = {}
    for (const [key, value] of Object.entries(block.extra ?? {})) {
      if (SUBFLOW_DATA_KEYS.has(key)) setOwn(extra, key, value)
    }
    if (Object.keys(extra).length > 0) view.subflowData = extra
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
