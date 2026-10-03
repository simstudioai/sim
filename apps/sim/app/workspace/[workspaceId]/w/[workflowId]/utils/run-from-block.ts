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
