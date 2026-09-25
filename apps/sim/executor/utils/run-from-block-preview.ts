import { type DAG, DAGBuilder } from '@/executor/dag/builder'
import type { SerializableExecutionState } from '@/executor/execution/types'
import {
  computeExecutionSets,
  type RunFromBlockValidation,
  validateRunFromBlock,
} from '@/executor/utils/run-from-block'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'
import type { SerializedWorkflow } from '@/serializer/types'

export interface RunFromBlockPreviewBlock {
  blockId: string
  name: string
  type: string
  executedInSource: boolean
}

export interface RunFromBlockPreview {
  validation: RunFromBlockValidation
  rerunBlocks: RunFromBlockPreviewBlock[]
  upstreamBlocks: (RunFromBlockPreviewBlock & { hasCachedOutput: boolean })[]
}

/** Projects internal sentinels and parallel instances back onto saved workflow blocks. */
function workflowBlockIds(nodeIds: Set<string>, dag: DAG): Set<string> {
  return new Set(
    [...nodeIds].map((nodeId) => {
      const node = dag.nodes.get(nodeId)
      return stripCloneSuffixes(
        node?.metadata.isSentinel ? (node.metadata.subflowId ?? nodeId) : nodeId
      )
    })
  )
}

/** Uses the executor's full graph and entry validation without running blocks or resolving inputs. */
export function previewRunFromBlock(
  workflow: SerializedWorkflow,
  startBlockId: string,
  snapshot: SerializableExecutionState
): RunFromBlockPreview {
  const dag = new DAGBuilder().build(workflow, { includeAllBlocks: true })
  const validation = validateRunFromBlock(startBlockId, dag, new Set(snapshot.executedBlocks))
  const { dirtySet, reachableUpstreamSet } = computeExecutionSets(dag, startBlockId)
  const rerunIds = workflowBlockIds(dirtySet, dag)
  const upstreamIds = workflowBlockIds(reachableUpstreamSet, dag)
  const executedIds = new Set(snapshot.executedBlocks.map(stripCloneSuffixes))
  const cachedOutputIds = new Set(
    Object.entries(snapshot.blockStates)
      .filter(([, state]) => state.output !== undefined)
      .map(([blockId]) => stripCloneSuffixes(blockId))
  )
  const blocks = workflow.blocks.map((block) => ({
    blockId: block.id,
    name: block.metadata?.name ?? block.id,
    type: block.metadata?.id ?? '',
    executedInSource: executedIds.has(block.id),
  }))
  return {
    validation,
    rerunBlocks: blocks.filter((block) => rerunIds.has(block.blockId)),
    upstreamBlocks: blocks
      .filter((block) => upstreamIds.has(block.blockId) && !rerunIds.has(block.blockId))
      .map((block) => ({ ...block, hasCachedOutput: cachedOutputIds.has(block.blockId) })),
  }
}
