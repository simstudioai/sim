import type { WorkflowEdgeEndpoints } from '@sim/workflow-types/workflow'
import type { SerializableExecutionState } from '@/executor/execution/types'

export interface RunFromBlockDependencyState {
  isEntryBlock: boolean
  dependenciesSatisfied: boolean
}

/**
 * Evaluates whether a block has the cached upstream state required for run-from-block execution.
 */
export function getRunFromBlockDependencyState(
  blockId: string,
  edges: WorkflowEdgeEndpoints[],
  snapshot?: Pick<SerializableExecutionState, 'executedBlocks'>
): RunFromBlockDependencyState {
  const incomingEdges = edges.filter((edge) => edge.target === blockId)
  const isEntryBlock = incomingEdges.length === 0

  if (isEntryBlock) {
    return { isEntryBlock, dependenciesSatisfied: true }
  }

  if (!snapshot) {
    return { isEntryBlock, dependenciesSatisfied: false }
  }

  const executedBlocks = new Set(snapshot.executedBlocks)
  const blocksWithIncomingEdges = new Set(edges.map((edge) => edge.target))
  const dependenciesSatisfied = incomingEdges.every(
    (edge) => executedBlocks.has(edge.source) || !blocksWithIncomingEdges.has(edge.source)
  )

  return { isEntryBlock, dependenciesSatisfied }
}

const incomingSourcesByEdges = new WeakMap<
  readonly WorkflowEdgeEndpoints[],
  Map<string, string[]>
>()
const executedByList = new WeakMap<readonly string[], Set<string>>()

function incomingSourcesOf(edges: readonly WorkflowEdgeEndpoints[]): Map<string, string[]> {
  let incoming = incomingSourcesByEdges.get(edges)
  if (!incoming) {
    incoming = new Map()
    for (const edge of edges) {
      const sources = incoming.get(edge.target)
      if (sources) sources.push(edge.source)
      else incoming.set(edge.target, [edge.source])
    }
    incomingSourcesByEdges.set(edges, incoming)
  }
  return incoming
}

/**
 * {@link getRunFromBlockDependencyState}'s `dependenciesSatisfied`, cheap enough for a store
 * selector every block runs on every store change: the edges' incoming index and the snapshot's
 * executed set are built once per (immutable) array and shared, so each call reads only the
 * block's own incoming edges and answers a boolean that is stable under equality.
 */
export function selectRunFromBlockDependenciesSatisfied(
  blockId: string,
  edges: readonly WorkflowEdgeEndpoints[],
  snapshot?: Pick<SerializableExecutionState, 'executedBlocks'>
): boolean {
  const incoming = incomingSourcesOf(edges)
  const sources = incoming.get(blockId)
  if (!sources) return true
  if (!snapshot) return false
  let executed = executedByList.get(snapshot.executedBlocks)
  if (!executed) {
    executed = new Set(snapshot.executedBlocks)
    executedByList.set(snapshot.executedBlocks, executed)
  }
  const ran = executed
  return sources.every((source) => ran.has(source) || !incoming.has(source))
}
