import type { DAG } from '@/executor/dag/builder'
import type { SerializableExecutionState } from '@/executor/execution/snapshot'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionContext, ExecutionMetadata, SerializedSnapshot } from '@/executor/types'

function mapFromEntries<T>(map?: Map<string, T>): Record<string, T> | undefined {
  if (!map) return undefined
  return Object.fromEntries(map)
}

function setToArray<T>(set?: Set<T>): T[] | undefined {
  if (!set) return undefined
  return Array.from(set)
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
    let branchOutputs: any
    if (scope.branchOutputs instanceof Map) {
      branchOutputs = Object.fromEntries(scope.branchOutputs)
    } else {
      branchOutputs = scope.branchOutputs ?? {}
    }

    result[parallelId] = {
      ...scope,
      branchOutputs,
    }
  }
  return result
}

export function serializePauseSnapshot(
  context: ExecutionContext,
  triggerBlockIds: string[],
  dag?: DAG
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
  }

  const executionMetadata = {
    requestId:
      (context.metadata as any)?.requestId ??
      context.executionId ??
      context.workflowId ??
      'unknown',
    executionId: context.executionId ?? 'unknown',
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    userId: (context.metadata as any)?.userId ?? '',
    triggerType: (context.metadata as any)?.triggerType ?? 'manual',
    triggerBlockId: triggerBlockIds[0],
    useDraftState,
    startTime: context.metadata.startTime ?? new Date().toISOString(),
  }

  const snapshot = new ExecutionSnapshot(
    executionMetadata,
    context.workflow,
    {},
    context.environmentVariables ?? {},
    context.workflowVariables ?? {},
    context.selectedOutputs ?? [],
    state
  )

  return {
    snapshot: snapshot.toJSON(),
    triggerIds: triggerBlockIds,
  }
}
