import { DAGBuilder } from '@/executor/dag/builder'
import type { DAGNode } from '@/executor/dag/builder'
import type { SerializableExecutionState } from '@/executor/execution/snapshot'
import type { SerializedWorkflow } from '@/serializer/types'
import { createLogger } from '@/lib/logs/console/logger'

export interface RunFromBlockPlan {
  snapshotState: SerializableExecutionState
  resumePendingQueue: string[]
}

export interface BuildRunFromBlockPlanParams {
  serializedWorkflow: SerializedWorkflow
  previousState: SerializableExecutionState
  previousResolvedInputs?: Record<string, any>
  previousResolvedOutputs?: Record<string, any>
  previousWorkflow?: SerializedWorkflow
  startBlockId: string
  triggerBlockId: string
}

const logger = createLogger('RunFromBlockPlanner')

/**
 * Builds an execution plan for running a workflow starting from a specific block.
 *
 * Performs forward impact detection, upstream change analysis, backward pruning,
 * and snapshot pruning so that only the minimally required nodes are re-executed.
 */
export function buildRunFromBlockPlan(params: BuildRunFromBlockPlanParams): RunFromBlockPlan {
  const {
    serializedWorkflow,
    previousState,
    previousWorkflow,
    startBlockId,
    triggerBlockId,
    previousResolvedInputs,
    previousResolvedOutputs,
  } = params

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

  const triggerNodeIds = determineTriggerNodeIds(triggerBlockId, originalToNodeIds, dag.nodes)
  const stopNodeIds = new Set(startNodeIds)

  const forwardImpact = collectDownstreamNodes(dag.nodes, new Set(startNodeIds))

  const upstreamAnalysis = analyzeUpstreamDifferences({
    dag,
    triggerNodeIds,
    stopNodeIds,
    previousState,
    previousResolvedInputs,
    previousResolvedOutputs,
    currentWorkflow: serializedWorkflow,
    previousWorkflow,
  })

  const sinkNodes = identifySinkNodes(dag.nodes)
  const ancestorSet = collectAncestors(dag.nodes, sinkNodes)

  const prunedStartCandidates = deriveStartSet({
    upstreamCandidates: upstreamAnalysis.startCandidates,
    ancestorSet,
    stopNodeIds,
  })

  if (prunedStartCandidates.size === 0) {
    for (const nodeId of startNodeIds) {
      prunedStartCandidates.add(nodeId)
    }
  }

  const restartSeeds = new Set<string>([...prunedStartCandidates, ...stopNodeIds])
  const restartScope = collectDownstreamNodes(dag.nodes, restartSeeds)
  const loopIdsToReset = new Set<string>()
  const parallelIdsToReset = new Set<string>()
  const originalIdsInScope = new Set<string>()

  // Queue all pruned upstream changes - executor handles dependency resolution for downstream
  const queueStartSet = new Set(prunedStartCandidates)

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

  const resumePendingQueue = Array.from(queueStartSet).sort()
  snapshotState.pendingQueue = [...resumePendingQueue]

  if (snapshotState.activeExecutionPath) {
    snapshotState.activeExecutionPath = snapshotState.activeExecutionPath.filter(
      (nodeId) => !restartScope.has(nodeId)
    )
  }

  logPlanSummary({
    startBlockId,
    triggerBlockId,
    startNodeIds,
    forwardImpact,
    upstreamAnalysis,
    sinkNodes,
    ancestorSet,
    prunedStartSet: prunedStartCandidates,
    queueStartSet,
    restartScope,
  })

  return {
    snapshotState,
    resumePendingQueue,
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

function collectAncestors(nodes: Map<string, DAGNode>, sinks: Set<string>): Set<string> {
  const visited = new Set<string>()
  const stack = [...sinks]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) {
      continue
    }

    visited.add(current)
    const node = nodes.get(current)
    if (!node) {
      continue
    }

    for (const incoming of node.incomingEdges.values()) {
      if (!visited.has(incoming)) {
        stack.push(incoming)
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

function determineTriggerNodeIds(
  triggerBlockId: string,
  originalToNodeIds: Map<string, string[]>,
  nodes: Map<string, DAGNode>
): string[] {
  let triggerNodes = originalToNodeIds.get(triggerBlockId)

  if ((!triggerNodes || triggerNodes.length === 0) && nodes.has(triggerBlockId)) {
    triggerNodes = [triggerBlockId]
  }

  if (!triggerNodes || triggerNodes.length === 0) {
    const rootNodes = Array.from(nodes.values())
      .filter((node) => node.incomingEdges.size === 0)
      .map((node) => node.id)

    triggerNodes = rootNodes.length > 0 ? rootNodes : [triggerBlockId]
  }

  return triggerNodes
}

interface UpstreamAnalysisParams {
  dag: ReturnType<DAGBuilder['build']>
  triggerNodeIds: string[]
  stopNodeIds: Set<string>
  previousState: SerializableExecutionState
  previousResolvedInputs?: Record<string, any>
  previousResolvedOutputs?: Record<string, any>
  currentWorkflow: SerializedWorkflow
  previousWorkflow?: SerializedWorkflow
}

interface UpstreamAnalysisResult {
  startCandidates: Map<string, string[]>
  traversedNodes: Set<string>
}

function analyzeUpstreamDifferences(params: UpstreamAnalysisParams): UpstreamAnalysisResult {
  const {
    dag,
    triggerNodeIds,
    stopNodeIds,
    previousState,
    previousResolvedInputs,
    previousResolvedOutputs,
    currentWorkflow,
    previousWorkflow,
  } = params
  const startCandidates = new Map<string, string[]>()
  const traversedNodes = new Set<string>()
  const stack = triggerNodeIds.map((nodeId) => ({ nodeId, upstreamChanged: false as boolean }))
  const executedBlocks = new Set<string>(previousState.executedBlocks || [])

  // Build a map of block IDs to their current and previous definitions
  const currentBlocks = new Map<string, any>()
  const previousBlocks = new Map<string, any>()

  for (const block of currentWorkflow.blocks || []) {
    currentBlocks.set(block.id, block)
  }

  if (previousWorkflow) {
    for (const block of previousWorkflow.blocks || []) {
      previousBlocks.set(block.id, block)
    }
  }

  while (stack.length > 0) {
    const { nodeId, upstreamChanged } = stack.pop()!

    if (traversedNodes.has(nodeId)) {
      continue
    }
    traversedNodes.add(nodeId)

    const node = dag.nodes.get(nodeId)
    if (!node) {
      continue
    }

    const originalId = node.metadata?.originalBlockId ?? nodeId
    const reasons: string[] = []

    const previousBlockState =
      previousState.blockStates[nodeId] ?? previousState.blockStates[originalId]

    const hasPriorState =
      previousBlockState !== undefined ||
      executedBlocks.has(nodeId) ||
      executedBlocks.has(originalId) ||
      previousResolvedOutputs?.[originalId] !== undefined ||
      previousResolvedInputs?.[originalId] !== undefined

    if (!hasPriorState) {
      reasons.push('missing_prior_state')
    }

    // Check if the block definition itself changed
    const currentBlock = currentBlocks.get(originalId)
    const previousBlock = previousBlocks.get(originalId)

    if (currentBlock && previousBlock) {
      // Compare the block definitions (excluding metadata like position)
      const currentDefinition = JSON.stringify({
        type: currentBlock.type,
        subBlocks: currentBlock.subBlocks,
      })
      const previousDefinition = JSON.stringify({
        type: previousBlock.type,
        subBlocks: previousBlock.subBlocks,
      })

      if (currentDefinition !== previousDefinition) {
        reasons.push('block_definition_changed')
      }
    } else if (currentBlock && !previousBlock) {
      reasons.push('new_block')
    }

    // Note: We intentionally do NOT check incoming_edges_changed here because:
    // - Workflow topology changes (adding/removing unrelated blocks) shouldn't invalidate this block
    // - The output/input comparisons above already catch meaningful dependency changes
    // - This prevents false positives when the DAG structure evolves between runs

    if (stopNodeIds.has(nodeId)) {
      reasons.push('target_block')
    }

    const hasLocalChange = reasons.length > 0

    if (hasLocalChange) {
      startCandidates.set(nodeId, reasons)
    }

    const shouldPropagateChange = upstreamChanged || hasLocalChange

    if (stopNodeIds.has(nodeId)) {
      continue
    }

    for (const { target } of node.outgoingEdges.values()) {
      stack.push({ nodeId: target, upstreamChanged: shouldPropagateChange })
    }
  }

  return {
    startCandidates,
    traversedNodes,
  }
}

interface StartSetParams {
  upstreamCandidates: Map<string, string[]>
  ancestorSet: Set<string>
  stopNodeIds: Set<string>
}

function deriveStartSet(params: StartSetParams): Set<string> {
  const { upstreamCandidates, ancestorSet, stopNodeIds } = params
  const finalStartSet = new Set<string>()

  for (const candidate of upstreamCandidates.keys()) {
    if (ancestorSet.has(candidate) || stopNodeIds.has(candidate)) {
      finalStartSet.add(candidate)
    }
  }

  for (const nodeId of stopNodeIds) {
    finalStartSet.add(nodeId)
  }

  return finalStartSet
}

function identifySinkNodes(nodes: Map<string, DAGNode>): Set<string> {
  const sinks = new Set<string>()
  for (const node of nodes.values()) {
    if (node.outgoingEdges.size === 0) {
      sinks.add(node.id)
    }
  }
  return sinks
}

function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }
  return true
}

interface PlanSummaryLogParams {
  startBlockId: string
  triggerBlockId: string
  startNodeIds: string[]
  forwardImpact: Set<string>
  upstreamAnalysis: UpstreamAnalysisResult
  sinkNodes: Set<string>
  ancestorSet: Set<string>
  prunedStartSet: Set<string>
  queueStartSet: Set<string>
  restartScope: Set<string>
}

function logPlanSummary(params: PlanSummaryLogParams): void {
  const {
    startBlockId,
    triggerBlockId,
    startNodeIds,
    forwardImpact,
    upstreamAnalysis,
    sinkNodes,
    ancestorSet,
    prunedStartSet,
    queueStartSet,
    restartScope,
  } = params

  logger.info('Run-from-block forward impact traversal completed', {
    startBlockId,
    startNodeIds,
    affectedCount: forwardImpact.size,
    affectedNodes: Array.from(forwardImpact),
  })

  const upstreamDetails = Array.from(upstreamAnalysis.startCandidates.entries()).map(
    ([nodeId, reasons]) => ({
      nodeId,
      reasons,
    })
  )

  logger.info('Run-from-block upstream diff analysis', {
    triggerBlockId,
    traversedNodes: Array.from(upstreamAnalysis.traversedNodes),
    startCandidates: upstreamDetails,
  })

  logger.info('Run-from-block backward pruning summary', {
    sinkNodes: Array.from(sinkNodes),
    ancestorCount: ancestorSet.size,
    ancestorNodes: Array.from(ancestorSet),
    prunedStartSet: Array.from(prunedStartSet),
  })

  logger.info('Run-from-block queue and restart scope', {
    resumePendingQueue: Array.from(queueStartSet),
    restartScope: Array.from(restartScope),
    restartScopeSize: restartScope.size,
  })
}


