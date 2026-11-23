import { isPlainRecord } from '@sim/utils/object'
import { normalizeName } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'
import {
  buildLoopSentinelStartId,
  buildParallelSentinelStartId,
} from '@/executor/utils/subflow-node-id-codec'
import type { SerializedWorkflow } from '@/serializer/types'

/**
 * Checks if a block ID is a loop or parallel container and returns the sentinel-start ID if so.
 * Returns null if the block is not a container.
 */
export function resolveContainerToSentinelStart(blockId: string, dag: DAG): string | null {
  if (dag.loopConfigs.has(blockId)) {
    return buildLoopSentinelStartId(blockId)
  }
  if (dag.parallelConfigs.has(blockId)) {
    return buildParallelSentinelStartId(blockId)
  }
  return null
}

/**
 * Result of validating a block for run-from-block execution.
 */
export interface RunFromBlockValidation {
  valid: boolean
  error?: string
  /** Why the start was refused, by id, for callers that phrase their own guidance. */
  refusal?: RunFromBlockRefusal
}

/**
 * The structured reason behind a refused run-from-block start. `blockId` is always the
 * requested start block.
 */
export type RunFromBlockRefusal =
  | { kind: 'block_not_found'; blockId: string }
  | {
      kind: 'inside_subflow'
      blockId: string
      subflowId: string
      subflowType: 'loop' | 'parallel'
    }
  | { kind: 'upstream_not_executed'; blockId: string; upstreamBlockId: string }

/**
 * A run-from-block start the executor refused before running anything: the block is
 * missing, sits inside a loop or parallel, or has an upstream dependency the source
 * snapshot never executed. Its own class so the application layer can hand the reason
 * to the caller as a validation failure instead of the generic system-error fallback.
 */
export class RunFromBlockValidationError extends Error {
  readonly refusal?: RunFromBlockRefusal

  constructor(message: string, refusal?: RunFromBlockRefusal) {
    super(message)
    this.name = 'RunFromBlockValidationError'
    this.refusal = refusal
  }
}

/**
 * Context for run-from-block execution mode.
 */
export interface RunFromBlockContext {
  /** The block ID to start execution from */
  startBlockId: string
  /** Set of block IDs that need re-execution (start block + all downstream) */
  dirtySet: Set<string>
}

/**
 * Result of computing execution sets for run-from-block mode.
 */
export interface ExecutionSets {
  /** Blocks that need re-execution (start block + all downstream) */
  dirtySet: Set<string>
  /** Blocks that are upstream (ancestors) of the start block */
  upstreamSet: Set<string>
  /** Blocks that are upstream of any dirty block (for snapshot preservation) */
  reachableUpstreamSet: Set<string>
}

/**
 * Computes the dirty set, upstream set, and reachable upstream set.
 * - Dirty set: start block + all blocks reachable via outgoing edges (need re-execution)
 * - Upstream set: all blocks reachable via incoming edges from the start block
 * - Reachable upstream set: all non-dirty blocks that are upstream of ANY dirty block
 *   (includes sibling branches that dirty blocks may reference)
 *
 * For loop/parallel containers, starts from the sentinel-start node and includes
 * the container ID itself in the dirty set.
 *
 * @param dag - The workflow DAG
 * @param startBlockId - The block to start execution from
 * @returns Object containing dirtySet, upstreamSet, and reachableUpstreamSet
 */
export function computeExecutionSets(dag: DAG, startBlockId: string): ExecutionSets {
  const dirty = new Set<string>([startBlockId])
  const upstream = new Set<string>()
  const sentinelStartId = resolveContainerToSentinelStart(startBlockId, dag)
  const traversalStartId = sentinelStartId ?? startBlockId

  if (sentinelStartId) {
    dirty.add(sentinelStartId)
  }

  // BFS downstream for dirty set
  const downstreamQueue = [traversalStartId]
  while (downstreamQueue.length > 0) {
    const nodeId = downstreamQueue.shift()!
    const node = dag.nodes.get(nodeId)
    if (!node) continue

    for (const [, edge] of node.outgoingEdges) {
      if (!dirty.has(edge.target)) {
        dirty.add(edge.target)
        downstreamQueue.push(edge.target)
      }
    }
  }

  // BFS upstream from start block for upstream set
  const upstreamQueue = [traversalStartId]
  while (upstreamQueue.length > 0) {
    const nodeId = upstreamQueue.shift()!
    const node = dag.nodes.get(nodeId)
    if (!node) continue

    for (const sourceId of node.incomingEdges) {
      if (!upstream.has(sourceId)) {
        upstream.add(sourceId)
        upstreamQueue.push(sourceId)
      }
    }
  }

  // Compute reachable upstream: all non-dirty blocks upstream of ANY dirty block
  // This handles the case where a dirty block (like C in A->C, B->C) may reference
  // sibling branches (like B when running from A)
  const reachableUpstream = new Set<string>()
  for (const dirtyNodeId of dirty) {
    const node = dag.nodes.get(dirtyNodeId)
    if (!node) continue

    // BFS upstream from this dirty node
    const queue = [...node.incomingEdges]
    while (queue.length > 0) {
      const sourceId = queue.shift()!
      if (reachableUpstream.has(sourceId) || dirty.has(sourceId)) continue

      reachableUpstream.add(sourceId)
      const sourceNode = dag.nodes.get(sourceId)
      if (sourceNode) {
        queue.push(...sourceNode.incomingEdges)
      }
    }
  }

  return { dirtySet: dirty, upstreamSet: upstream, reachableUpstreamSet: reachableUpstream }
}

/**
 * Validates that a block can be used as a run-from-block starting point.
 *
 * Validation rules:
 * - Block must exist in the DAG (or be a loop/parallel container)
 * - Block cannot be inside a loop (but loop containers are allowed)
 * - Block cannot be inside a parallel (but parallel containers are allowed)
 * - Block cannot be a sentinel node
 * - All upstream dependencies must have been executed (have cached outputs)
 *
 * @param blockId - The block ID to validate
 * @param dag - The workflow DAG
 * @param executedBlocks - Set of blocks that were executed in the source run
 * @param blockNames - Display names by block id, so the message names blocks instead of ids
 * @returns Validation result with error message if invalid
 */
export function validateRunFromBlock(
  blockId: string,
  dag: DAG,
  executedBlocks: Set<string>,
  blockNames: ReadonlyMap<string, string> = new Map()
): RunFromBlockValidation {
  const label = (id: string) => blockNames.get(id) ?? id
  const insideSubflow = (
    subflowId: string | undefined,
    subflowType: 'loop' | 'parallel'
  ): RunFromBlockValidation => {
    if (!subflowId) {
      return { valid: false, error: `Cannot run from block inside ${subflowType}: ${blockId}` }
    }
    return {
      valid: false,
      error: `Cannot run from block inside ${subflowType}: ${label(subflowId)}. Run the ${subflowType} or the whole workflow instead.`,
      refusal: { kind: 'inside_subflow', blockId, subflowId, subflowType },
    }
  }

  const container = findOutermostContainer(blockId, dag)
  if (container) return insideSubflow(container.id, container.type)

  const node = dag.nodes.get(blockId)
  const isLoopContainer = dag.loopConfigs.has(blockId)
  const isParallelContainer = dag.parallelConfigs.has(blockId)
  const isContainer = isLoopContainer || isParallelContainer
  let validationNode = node

  if (!node && !isContainer) {
    return {
      valid: false,
      error: `Block not found in workflow: ${blockId}`,
      refusal: { kind: 'block_not_found', blockId },
    }
  }

  if (isContainer) {
    const sentinelStartId = resolveContainerToSentinelStart(blockId, dag)
    if (!sentinelStartId || !dag.nodes.has(sentinelStartId)) {
      return {
        valid: false,
        error: `Container sentinel not found for: ${blockId}`,
      }
    }
    validationNode = dag.nodes.get(sentinelStartId)
  }

  if (node) {
    // A branch-clone id (`block₍0₎`) is in no subflow config, so findOutermostContainer misses it.
    if (node.metadata.isParallelBranch) return insideSubflow(node.metadata.subflowId, 'parallel')

    if (node.metadata.isSentinel) {
      return { valid: false, error: 'Cannot run from sentinel node' }
    }
  }

  if (validationNode) {
    // Check immediate upstream dependencies were executed
    for (const sourceId of validationNode.incomingEdges) {
      const sourceNode = dag.nodes.get(sourceId)
      // Skip sentinel nodes - they're internal and not in executedBlocks
      if (sourceNode?.metadata.isSentinel) continue

      // Skip trigger nodes - they're entry points and don't need prior execution
      // A trigger node has no incoming edges
      if (sourceNode && sourceNode.incomingEdges.size === 0) continue

      if (!executedBlocks.has(sourceId)) {
        return {
          valid: false,
          error: `Upstream dependency not executed: ${label(sourceId)}`,
          refusal: { kind: 'upstream_not_executed', blockId, upstreamBlockId: sourceId },
        }
      }
    }
  }

  return { valid: true }
}

/**
 * The top-level loop or parallel a block sits in, however deeply nested. A nested container
 * is refused as a start too, so naming the immediate parent would point at another refusal.
 * Parallel children are matched by their workflow id, which the DAG only holds as branch clones.
 */
function findOutermostContainer(
  blockId: string,
  dag: DAG
): { id: string; type: 'loop' | 'parallel' } | undefined {
  let outermost: { id: string; type: 'loop' | 'parallel' } | undefined
  const visited = new Set([blockId])
  let current = blockId
  while (true) {
    const loopId = findParentLoop(current, dag)
    const parallelId = loopId ? undefined : findParentParallel(current, dag)
    const parent = loopId
      ? { id: loopId, type: 'loop' as const }
      : parallelId
        ? { id: parallelId, type: 'parallel' as const }
        : undefined
    if (!parent || visited.has(parent.id)) return outermost
    visited.add(parent.id)
    outermost = parent
    current = parent.id
  }
}

function findParentLoop(blockId: string, dag: DAG): string | undefined {
  for (const [loopId, config] of dag.loopConfigs) {
    if (loopId !== blockId && config.nodes?.includes(blockId)) {
      return loopId
    }
  }
  return undefined
}

function findParentParallel(blockId: string, dag: DAG): string | undefined {
  for (const [parallelId, config] of dag.parallelConfigs) {
    if (parallelId !== blockId && config.nodes?.includes(blockId)) {
      return parallelId
    }
  }
  return undefined
}

/**
 * Overlays caller-provided mock outputs onto a run-from-block snapshot so a
 * block can run in isolation: each entry (keyed by block name or id) becomes
 * that block's state, marked executed, overriding whatever the snapshot holds.
 * Name matching uses the executor's own normalization — the same rule reference
 * resolution applies — and an unknown key fails fast with the names that do
 * exist, since a silently dropped mock would just resurface as an unresolved
 * reference deeper in the run.
 */
export function overlayVariableInputs(
  workflow: SerializedWorkflow,
  snapshot: SerializableExecutionState,
  variableInputs: Record<string, unknown>
): SerializableExecutionState {
  const idsByName = new Map<string, string>()
  for (const block of workflow.blocks) {
    if (block.metadata?.name) idsByName.set(normalizeName(block.metadata.name), block.id)
  }
  const blockIds = new Set(workflow.blocks.map((block) => block.id))

  const blockStates = { ...snapshot.blockStates }
  const executedBlocks = [...snapshot.executedBlocks]
  for (const [key, value] of Object.entries(variableInputs)) {
    const blockId = blockIds.has(key) ? key : idsByName.get(normalizeName(key))
    if (!blockId) {
      const known = workflow.blocks
        .map((block) => block.metadata?.name)
        .filter((name): name is string => Boolean(name))
      throw new Error(
        `variableInputs: no block named "${key}" in this workflow. Blocks: ${known.join(', ')}`
      )
    }
    if (!isPlainRecord(value)) {
      throw new Error(
        `variableInputs["${key}"] must be an object shaped like that block's output (references read paths off it).`
      )
    }
    blockStates[blockId] = {
      output: value as NormalizedBlockOutput,
      executed: true,
      executionTime: 0,
    }
    if (!executedBlocks.includes(blockId)) executedBlocks.push(blockId)
  }
  return { ...snapshot, blockStates, executedBlocks }
}

/** The empty prior-state a pure-mock isolated run starts from. */
export function emptyRunFromBlockSnapshot(): SerializableExecutionState {
  return {
    blockStates: {},
    executedBlocks: [],
    blockLogs: [],
    decisions: { router: {}, condition: {} },
    completedLoops: [],
    activeExecutionPath: [],
  }
}
