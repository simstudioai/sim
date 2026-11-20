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
import { SUBFLOW_DATA_KEYS, SUPERSEDED_CONTAINER_PARAMS } from '../canonicalize/subflows'
import { executableInactiveParams } from '../catalog/activity'
import { isCanonicalPair } from '../catalog/canonical-index'
import { serializedCanonicalIndex } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import { LOADER_PARALLEL_TYPE, runningConfig } from '../forms/subflow'
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

/**
 * A loop or parallel config exactly as the executor reads it for the type in effect: the fields of
 * the type's form (`forms/subflow.ts`), keyed by spec field, each with the runtime's fallback.
 */
type ExecutableSubflow =
  | { kind: 'loop'; loopType: LoopType; config: Record<string, Json> }
  | { kind: 'parallel'; parallelType: ParallelType; config: Record<string, Json> }

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

/** A loop or parallel config as the executor reads it for the type in effect. */
export function executableSubflow(spec: LoopSpec | ParallelSpec): ExecutableSubflow {
  const config = runningConfig(spec)
  return spec.kind === 'loop'
    ? { kind: 'loop', loopType: spec.loopType, config }
    : { kind: 'parallel', parallelType: spec.parallelType ?? LOADER_PARALLEL_TYPE, config }
}

/** The executable form of one block's params: inactive values dropped, pairs keyed by id. */
function executableParams(
  block: CanonicalBlock,
  declared: CatalogBlock | undefined,
  catalog: BlockCatalog
): Record<string, CanonicalParam> {
  if (!declared) {
    if (!block.subflow) return { ...block.params }
    const params: Record<string, CanonicalParam> = {}
    for (const [id, param] of Object.entries(block.params)) {
      if (!SUPERSEDED_CONTAINER_PARAMS.has(id)) setOwn(params, id, param)
    }
    return params
  }
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
