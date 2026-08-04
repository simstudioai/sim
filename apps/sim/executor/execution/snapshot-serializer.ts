import { recordMaterializedAccessKeys } from '@/lib/execution/payloads/access-keys'
import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload, compactSubflowResults } from '@/lib/execution/payloads/serializer'
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

/**
 * Per-value offload ceiling applied once the subflow state is already oversized.
 *
 * Deliberately far below the snapshot's own limit. The assertion measures the
 * *combined* record, so scopes that are each individually under it still fail
 * together — compacting at the snapshot ceiling would be a no-op in exactly the
 * case that needs it. Only reached when the state is already too large, so the
 * fidelity cost lands on runs that would otherwise fail outright.
 */
const PAUSE_SNAPSHOT_COMPACT_VALUE_BYTES = 64 * 1024

/**
 * Whether the serialized subflow state is already past what the snapshot allows.
 *
 * Measured on the serialized shape because that is what the assertions read,
 * and bounded so an oversized structure short-circuits instead of being walked
 * in full.
 */
function isSubflowStateOversized(loops?: Map<string, any>, parallels?: Map<string, any>): boolean {
  const limit = LARGE_VALUE_THRESHOLD_BYTES
  const loopBytes = getBoundedJsonByteLength(serializeLoopExecutions(loops), limit)
  if (loopBytes !== undefined && loopBytes > limit) return true
  const parallelBytes = getBoundedJsonByteLength(serializeParallelExecutions(parallels), limit)
  return parallelBytes !== undefined && parallelBytes > limit
}

/**
 * Offload accumulated subflow state so a pause snapshot stays under the size
 * assertions below.
 *
 * A loop or parallel compacts its accumulated outputs when it *exits*, but a
 * pause is by definition mid-flight and never reaches that point. The running
 * total therefore arrives here uncompacted and trips the assertion, which
 * throws rather than degrades — turning the pause into a failed run, so no
 * paused-execution row is ever written. The approval notification has already
 * gone out by then, leaving the approver holding a link to something that was
 * never recorded.
 *
 * Every field that grows without an aggregate bound is covered: a loop's
 * iteration outputs, its in-flight iteration outputs and its `forEach`
 * collection, and the parallel equivalents. Compacting only one of them would
 * leave the same failure reachable by a different route.
 *
 * Skipped entirely when the state already serializes small enough, so the
 * common case — a pause per iteration inside a modest loop — pays one bounded
 * measurement rather than a full structural rebuild each time.
 */
export async function compactPauseSnapshotScopes(context: ExecutionContext): Promise<void> {
  const loops = context.loopExecutions
  const parallels = context.parallelExecutions
  if (!loops?.size && !parallels?.size) return
  if (!isSubflowStateOversized(loops, parallels)) return

  const buildOptions = () => ({
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    largeValueExecutionIds: context.largeValueExecutionIds,
    largeValueKeys: context.largeValueKeys,
    allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
    userId: context.userId,
    requireDurable: true,
    thresholdBytes: PAUSE_SNAPSHOT_COMPACT_VALUE_BYTES,
  })

  const compactList = async <T>(values: T[]): Promise<T[]> =>
    compactSubflowResults(values, buildOptions())

  const compactMapValues = async (map: Map<unknown, unknown[]>): Promise<void> => {
    for (const [key, value] of map) {
      if (Array.isArray(value) && value.length > 0) {
        map.set(key, await compactList(value))
      }
    }
  }

  for (const scope of loops?.values() ?? []) {
    if (scope.allIterationOutputs?.length) {
      scope.allIterationOutputs = await compactList(scope.allIterationOutputs)
    }
    if (scope.items?.length) {
      scope.items = await compactList(scope.items)
    }
    if (scope.currentIterationOutputs instanceof Map && scope.currentIterationOutputs.size > 0) {
      for (const [blockId, output] of scope.currentIterationOutputs) {
        scope.currentIterationOutputs.set(
          blockId,
          await compactExecutionPayload(output, { ...buildOptions(), preserveRoot: false })
        )
      }
    }
    recordMaterializedAccessKeys(context, scope)
  }

  for (const scope of parallels?.values() ?? []) {
    if (scope.items?.length) {
      scope.items = await compactList(scope.items)
    }
    if (scope.branchOutputs instanceof Map) {
      await compactMapValues(scope.branchOutputs)
    }
    if (scope.accumulatedOutputs instanceof Map) {
      await compactMapValues(scope.accumulatedOutputs)
    }
    recordMaterializedAccessKeys(context, scope)
  }
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
    sourceExecutionId: context.executionId,
    trustedLargeValueAccess: {
      executionIds: Array.from(
        new Set(
          [context.executionId, ...(context.largeValueExecutionIds ?? [])].filter(
            (id): id is string => Boolean(id)
          )
        )
      ),
      largeValueKeys: Array.from(new Set(context.largeValueKeys ?? [])),
      fileKeys: Array.from(new Set(context.fileKeys ?? [])),
    },
    resolvedSecretTraceProvenance: context.resolvedSecretTraceRegistry?.exportProvenance(),
  }

  assertSnapshotValueIsCompact(context.workflowVariables, 'workflow variables')
  assertSnapshotValueIsCompact(state.loopExecutions, 'loop execution state')
  assertSnapshotValueIsCompact(state.parallelExecutions, 'parallel execution state')

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
    /** Preserve deployed-chat thinking gate across HITL pause/resume. */
    includeThinking: metadataFromContext?.includeThinking === true ? true : undefined,
    /** Preserve false as distinct from a legacy snapshot with no independent tool policy. */
    includeToolCalls:
      typeof metadataFromContext?.includeToolCalls === 'boolean'
        ? metadataFromContext.includeToolCalls
        : undefined,
    /** Preserve the run-level agent-events opt-in across HITL pause/resume. */
    agentEvents: metadataFromContext?.agentEvents === true ? true : undefined,
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
