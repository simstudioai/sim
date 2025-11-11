import { DAGBuilder } from '@/executor/dag/builder'
import type { DAGNode } from '@/executor/dag/builder'
import type { SerializableExecutionState } from '@/executor/execution/snapshot'
import type { SerializedWorkflow } from '@/serializer/types'

export interface RunFromBlockPlan {
  snapshotState: SerializableExecutionState
  resumePendingQueue: string[]
}

export interface BuildRunFromBlockPlanParams {
  serializedWorkflow: SerializedWorkflow
  previousState: SerializableExecutionState
  startBlockId: string
}

export function buildRunFromBlockPlan(params: BuildRunFromBlockPlanParams): RunFromBlockPlan {
  const { serializedWorkflow, previousState, startBlockId } = params

  const dagBuilder = new DAGBuilder()
  const dag = dagBuilder.build(serializedWorkflow)

  const originalToNodeIds = mapOriginalIdsToNodes(dag.nodes)
  let startNodeIds = originalToNodeIds.get(startBlockId)

  if (!startNodeIds || startNodeIds.length === 0) {
    if (dag.nodes.has(startBlockId)) {
      startNodeIds = [startBlockId]
    } else {
      throw new Error(`Start block ${startBlockId} not found in workflow DAG`)
    }
  }

  const restartScope = collectDownstreamNodes(dag.nodes, new Set(startNodeIds))
  const loopIdsToReset = new Set<string>()
  const parallelIdsToReset = new Set<string>()
  const originalIdsInScope = new Set<string>()

  for (const nodeId of restartScope) {
    const node = dag.nodes.get(nodeId)
    if (!node) continue
    if (node.metadata?.loopId) {
      loopIdsToReset.add(node.metadata.loopId)
    }
    if (node.metadata?.parallelId) {
      parallelIdsToReset.add(node.metadata.parallelId)
    }
    if (node.metadata?.originalBlockId) {
      originalIdsInScope.add(node.metadata.originalBlockId)
    }
  }

  const snapshotState = cloneSerializableState(previousState)

  // Reset block states and execution markers for nodes in restart scope
  for (const nodeId of restartScope) {
    delete snapshotState.blockStates[nodeId]
    if (snapshotState.parallelBlockMapping) {
      delete snapshotState.parallelBlockMapping[nodeId]
    }
  }
  for (const originalId of originalIdsInScope) {
    delete snapshotState.blockStates[originalId]
  }

  snapshotState.executedBlocks = (snapshotState.executedBlocks || []).filter(
    (executedId) => !restartScope.has(executedId) && !originalIdsInScope.has(executedId)
  )

  snapshotState.blockLogs = (snapshotState.blockLogs || []).filter(
    (log) => !restartScope.has(log.blockId) && !originalIdsInScope.has(log.blockId)
  )

  if (snapshotState.decisions) {
    snapshotState.decisions.router = filterDecisionMap(
      snapshotState.decisions.router,
      restartScope,
      originalIdsInScope
    )
    snapshotState.decisions.condition = filterDecisionMap(
      snapshotState.decisions.condition,
      restartScope,
      originalIdsInScope
    )
  }

  if (snapshotState.parallelExecutions) {
    for (const parallelId of parallelIdsToReset) {
      delete snapshotState.parallelExecutions[parallelId]
    }
  }

  if (snapshotState.loopExecutions) {
    for (const loopId of loopIdsToReset) {
      delete snapshotState.loopExecutions[loopId]
    }
  }

  if (snapshotState.completedLoops) {
    snapshotState.completedLoops = snapshotState.completedLoops.filter(
      (loopId) => !loopIdsToReset.has(loopId)
    )
  }

  snapshotState.pendingQueue = [...startNodeIds]

  if (snapshotState.activeExecutionPath) {
    snapshotState.activeExecutionPath = snapshotState.activeExecutionPath.filter(
      (nodeId) => !restartScope.has(nodeId)
    )
  }

  return {
    snapshotState,
    resumePendingQueue: [...startNodeIds],
  }
}

function mapOriginalIdsToNodes(nodes: Map<string, DAGNode>): Map<string, string[]> {
  const mapping = new Map<string, string[]>()
  for (const [nodeId, node] of nodes.entries()) {
    const originalId = node.metadata?.originalBlockId ?? nodeId
    if (!mapping.has(originalId)) {
      mapping.set(originalId, [])
    }
    mapping.get(originalId)!.push(nodeId)
  }
  return mapping
}

function collectDownstreamNodes(
  nodes: Map<string, DAGNode>,
  seeds: Set<string>
): Set<string> {
  const visited = new Set<string>(seeds)
  const stack = [...seeds]

  while (stack.length > 0) {
    const current = stack.pop()!
    const node = nodes.get(current)
    if (!node) continue

    for (const edge of node.outgoingEdges.values()) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target)
        stack.push(edge.target)
      }
    }
  }

  return visited
}

function cloneSerializableState(
  state: SerializableExecutionState
): SerializableExecutionState {
  return JSON.parse(JSON.stringify(state)) as SerializableExecutionState
}

function filterDecisionMap(
  decisions: Record<string, string>,
  restartScope: Set<string>,
  originalIds: Set<string>
): Record<string, string> {
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(decisions || {})) {
    if (restartScope.has(key) || originalIds.has(key)) {
      continue
    }
    filtered[key] = value
  }
  return filtered
}

