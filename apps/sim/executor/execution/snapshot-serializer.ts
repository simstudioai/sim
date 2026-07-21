import { getBoundedJsonByteLength } from '@/lib/core/utils/json-size'
import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionContext, SerializedSnapshot } from '@/executor/types'

function assertSnapshotValueIsCompact(value: unknown, label: string): void {
  const byteLength = getBoundedJsonByteLength(value, LARGE_VALUE_THRESHOLD_BYTES)
  if (byteLength !== undefined && byteLength > LARGE_VALUE_THRESHOLD_BYTES) {
    throw new Error(`Cannot serialize pause snapshot with oversized ${label}; compact it first.`)
  }
}

function mapFromEntries<T>(map?: Map<string, T>): Record<string, T> | undefined {
  if (!map) return undefined
  return Object.fromEntries(map)
}

function serializeLoopExecutions(
  loopExecutions?: Map<string, any>
): Record<string, any> | undefined {
  if (!loopExecutions) return undefined
  const result: Record<string, any> = {}
  for (const [loopId, scope] of loopExecutions.entries()) {
    let currentIterationOutputs: any
    if (scope.currentIterationOutputs instanceof Map) {
      currentIterationOutputs = Object.fromEntries(scope.currentIterationOutputs)
    } else {
      currentIterationOutputs = scope.currentIterationOutputs ?? {}
    }

    result[loopId] = {
      ...scope,
      currentIterationOutputs,
    }
  }
  return result
}

function serializeParallelExecutions(
  parallelExecutions?: Map<string, any>
): Record<string, any> | undefined {
  if (!parallelExecutions) return undefined
  const result: Record<string, any> = {}
  for (const [parallelId, scope] of parallelExecutions.entries()) {
    const branchOutputs =
      scope.branchOutputs instanceof Map
        ? Object.fromEntries(scope.branchOutputs)
        : (scope.branchOutputs ?? {})
    const accumulatedOutputs =
      scope.accumulatedOutputs instanceof Map
        ? Object.fromEntries(scope.accumulatedOutputs)
        : (scope.accumulatedOutputs ?? {})

    result[parallelId] = {
      ...scope,
      branchOutputs,
      accumulatedOutputs,
    }
  }
  return result
}

export function serializePauseSnapshot(
  context: ExecutionContext,
  triggerBlockIds: string[],
  dag?: DAG,
  edgeManager?: EdgeManager
): SerializedSnapshot {
  const metadataFromContext = context.metadata as ExecutionMetadata | undefined
  let useDraftState: boolean
  if (metadataFromContext?.useDraftState !== undefined) {
    useDraftState = metadataFromContext.useDraftState
  } else if (context.isDeployedContext === true) {
    useDraftState = false
  } else {
    useDraftState = true
  }

  const dagIncomingEdges: Record<string, string[]> | undefined = dag
    ? Object.fromEntries(
        Array.from(dag.nodes.entries()).map(([nodeId, node]) => [
          nodeId,
          Array.from(node.incomingEdges),
        ])
      )
    : undefined

  const state: SerializableExecutionState = {
    blockStates: Object.fromEntries(context.blockStates),
    executedBlocks: Array.from(context.executedBlocks),
    blockLogs: context.blockLogs,
    decisions: {
      router: Object.fromEntries(context.decisions.router),
      condition: Object.fromEntries(context.decisions.condition),
    },
    completedLoops: Array.from(context.completedLoops),
    loopExecutions: serializeLoopExecutions(context.loopExecutions),
    parallelExecutions: serializeParallelExecutions(context.parallelExecutions),
    parallelBlockMapping: mapFromEntries(context.parallelBlockMapping),
    activeExecutionPath: Array.from(context.activeExecutionPath),
    pendingQueue: triggerBlockIds,
    dagIncomingEdges,
    deactivatedEdges: edgeManager?.getDeactivatedEdges(),
    nodesWithActivatedEdge: edgeManager?.getNodesWithActivatedEdge(),
  }

  assertSnapshotValueIsCompact(context.workflowVariables, 'workflow variables')
  assertSnapshotValueIsCompact(state.loopExecutions, 'loop execution state')

  const workspaceId = metadataFromContext?.workspaceId ?? context.workspaceId
  if (!workspaceId) {
    throw new Error(
      `Cannot serialize pause snapshot: missing workspaceId for workflow ${context.workflowId}`
    )
  }

  const executionMetadata: ExecutionMetadata = {
    requestId:
      metadataFromContext?.requestId ?? context.executionId ?? context.workflowId ?? 'unknown',
    executionId: context.executionId ?? 'unknown',
    workflowId: context.workflowId,
    workspaceId,
    userId: metadataFromContext?.userId ?? '',
    billingAttribution: metadataFromContext?.billingAttribution,
    sessionUserId: metadataFromContext?.sessionUserId,
    workflowUserId: metadataFromContext?.workflowUserId,
    triggerType: metadataFromContext?.triggerType ?? 'manual',
    triggerBlockId: triggerBlockIds[0],
    useDraftState,
    startTime: metadataFromContext?.startTime ?? new Date().toISOString(),
    isClientSession: metadataFromContext?.isClientSession,
    executionMode: metadataFromContext?.executionMode,
  }

  const snapshot = new ExecutionSnapshot(
    executionMetadata,
    context.workflow,
    {},
    context.workflowVariables,
    context.selectedOutputs,
    state
  )

  return {
    snapshot: snapshot.toJSON(),
    triggerIds: triggerBlockIds,
  }
}
