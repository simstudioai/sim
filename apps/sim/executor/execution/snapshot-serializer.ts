import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { SerializableExecutionState } from '@/executor/execution/snapshot'
import type { ExecutionContext, SerializedSnapshot } from '@/executor/types'

function mapFromEntries<T>(map?: Map<string, T>): Record<string, T> | undefined {
  if (!map) return undefined
  return Object.fromEntries(map)
}

function setToArray<T>(set?: Set<T>): T[] | undefined {
  if (!set) return undefined
  return Array.from(set)
}

export function serializePauseSnapshot(
  context: ExecutionContext,
  triggerBlockIds: string[]
): SerializedSnapshot {
  const state: SerializableExecutionState = {
    blockStates: Object.fromEntries(context.blockStates),
    executedBlocks: Array.from(context.executedBlocks),
    blockLogs: context.blockLogs,
    decisions: {
      router: Object.fromEntries(context.decisions.router),
      condition: Object.fromEntries(context.decisions.condition),
    },
    loopIterations: Object.fromEntries(context.loopIterations),
    loopItems: Object.fromEntries(context.loopItems),
    completedLoops: Array.from(context.completedLoops),
    loopExecutions: mapFromEntries(context.loopExecutions),
    parallelExecutions: mapFromEntries(context.parallelExecutions),
    parallelBlockMapping: mapFromEntries(context.parallelBlockMapping),
    activeExecutionPath: Array.from(context.activeExecutionPath),
    pendingQueue: triggerBlockIds,
  }

  const executionMetadata = {
    requestId:
      (context.metadata as any)?.requestId ?? context.executionId ?? context.workflowId ?? 'unknown',
    executionId: context.executionId ?? 'unknown',
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    userId: (context.metadata as any)?.userId ?? '',
    triggerType: (context.metadata as any)?.triggerType ?? 'manual',
    triggerBlockId: triggerBlockIds[0],
    useDraftState: false,
    startTime: context.metadata.startTime ?? new Date().toISOString(),
  }

  const snapshot = new ExecutionSnapshot(
    executionMetadata,
    context.workflow,
    {},
    context.environmentVariables,
    context.workflowVariables || {},
    context.selectedOutputs || [],
    state
  )

  return {
    snapshot: snapshot.toJSON(),
    triggerIds: triggerBlockIds,
  }
}


