import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionContext, SerializedSnapshot } from '@/executor/types'

const JSON_SYNTAX_BYTES = {
  QUOTE: 1,
  COLON: 1,
  COMMA: 1,
  ARRAY_BRACKETS: 2,
  OBJECT_BRACES: 2,
  NULL: 4,
} as const

function getEscapedJsonStringByteLength(value: string): number {
  let bytes = JSON_SYNTAX_BYTES.QUOTE * 2
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      bytes += 2
    } else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2
    } else if (code < 0x20) {
      bytes += 6
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index++
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else {
      bytes += 3
    }
  }
  return bytes
}

function getPrimitiveJsonByteLength(value: unknown): number | undefined {
  if (value === null) {
    return JSON_SYNTAX_BYTES.NULL
  }
  if (typeof value === 'string') {
    return getEscapedJsonStringByteLength(value)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? Buffer.byteLength(String(value), 'utf8')
      : JSON_SYNTAX_BYTES.NULL
  }
  if (typeof value === 'boolean') {
    return value ? 4 : 5
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt')
  }
  return undefined
}

function getBoundedJsonByteLength(
  value: unknown,
  maxBytes: number,
  seen = new WeakSet<object>()
): number | undefined {
  const primitiveSize = getPrimitiveJsonByteLength(value)
  if (primitiveSize !== undefined) {
    return primitiveSize
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (seen.has(value)) {
    throw new TypeError('Converting circular structure to JSON')
  }
  seen.add(value)

  let bytes = Array.isArray(value)
    ? JSON_SYNTAX_BYTES.ARRAY_BRACKETS
    : JSON_SYNTAX_BYTES.OBJECT_BRACES
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (index > 0) bytes += JSON_SYNTAX_BYTES.COMMA
      const itemSize = getBoundedJsonByteLength(value[index], maxBytes - bytes, seen)
      bytes += itemSize ?? JSON_SYNTAX_BYTES.NULL
      if (bytes > maxBytes) return bytes
    }
    seen.delete(value)
    return bytes
  }

  let hasEntries = false
  for (const key of Object.keys(value)) {
    const entryValue = (value as Record<string, unknown>)[key]
    if (
      entryValue === undefined ||
      typeof entryValue === 'function' ||
      typeof entryValue === 'symbol'
    ) {
      continue
    }
    if (hasEntries) bytes += JSON_SYNTAX_BYTES.COMMA
    bytes += getEscapedJsonStringByteLength(key) + JSON_SYNTAX_BYTES.COLON
    const entrySize = getBoundedJsonByteLength(entryValue, maxBytes - bytes, seen)
    bytes += entrySize ?? JSON_SYNTAX_BYTES.NULL
    hasEntries = true
    if (bytes > maxBytes) return bytes
  }

  seen.delete(value)
  return bytes
}

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
