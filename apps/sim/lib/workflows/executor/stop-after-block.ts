import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { DAGBuilder } from '@/executor/dag/builder'
import {
  computeExecutionSets,
  resolveContainerToSentinelStart,
} from '@/executor/utils/run-from-block'
import { Serializer } from '@/serializer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Checks the stop target against the caller's resolved entry, never a DAG-selected fallback. */
export function validateStopAfterBlock(
  state: Pick<WorkflowState, 'blocks' | 'edges' | 'loops' | 'parallels'>,
  blockId: string,
  triggerBlockId?: string,
  fromBlockId?: string
): void {
  if (!triggerBlockId && !fromBlockId) {
    throw new Error('stopAfterBlockId requires a resolved trigger or partial-run starting block.')
  }
  const block = state.blocks[blockId]
  if (!block || block.enabled === false) {
    throw new Error(
      `stopAfterBlockId "${blockId}" must name an enabled block in the selected workflow state.`
    )
  }
  const serialized = new Serializer().serializeWorkflow(
    mergeSubblockStateWithValues(state.blocks),
    state.edges,
    state.loops,
    state.parallels,
    true
  )
  const dag = new DAGBuilder().build(serialized, {
    triggerBlockId,
    includeAllBlocks: Boolean(fromBlockId),
  })
  const sentinelId = resolveContainerToSentinelStart(blockId, dag)
  const nodeId = sentinelId ?? blockId
  const node = dag.nodes.get(nodeId)
  if (!node || (fromBlockId && !computeExecutionSets(dag, fromBlockId).dirtySet.has(nodeId))) {
    throw new Error(`stopAfterBlockId "${blockId}" is not reachable from the selected entry point.`)
  }
  if (
    node.metadata.isLoopNode ||
    node.metadata.isParallelBranch ||
    [...dag.loopConfigs].some(([id, config]) => id !== blockId && config.nodes.includes(blockId)) ||
    [...dag.parallelConfigs].some(
      ([id, config]) => id !== blockId && config.nodes.includes(blockId)
    )
  ) {
    throw new Error(
      `stopAfterBlockId "${blockId}" is inside a loop or parallel. Choose its top-level container to stop after all iterations complete.`
    )
  }
}
