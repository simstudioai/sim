import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import type {
  WorkflowEvalOutputSelector,
  WorkflowEvalWorkflowInputMapping,
} from '@/lib/api/contracts/workflow-evals'
import {
  isLargeDataKey,
  isSensitiveKey,
  REDACTED_MARKER,
  redactSensitiveValues,
  TRUNCATED_MARKER,
} from '@/lib/core/security/redaction'
import { getBoundedJsonByteLength } from '@/lib/core/utils/json-size'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import { REDACTION_FAILED_MARKER } from '@/lib/logs/execution/pii-redaction'
import { TRACE_STORE_REF_KEY } from '@/lib/logs/execution/trace-store'
import type { TraceSpan } from '@/lib/logs/types'
import { pluckByPath } from '@/lib/table/pluck'
import { isAgentBlockType, isWorkflowBlockType } from '@/executor/constants'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'

export const MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES = 256 * 1024
export const MAX_WORKFLOW_EVAL_SELECTED_OUTPUT_BYTES = 64 * 1024
export const MAX_WORKFLOW_EVAL_TOOL_VALUE_BYTES = 16 * 1024
export const MAX_WORKFLOW_EVAL_TRACE_SPANS = 2_000
export const MAX_WORKFLOW_EVAL_TOOL_CALLS = 500
export const MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES = 64 * 1024 * 1024

const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const INCOMPLETE_VALUE_MARKERS = new Set([
  REDACTION_FAILED_MARKER,
  TRUNCATED_MARKER,
  '[Circular Reference]',
  '[Error accessing property]',
  '[Max Depth Exceeded]',
  '[Unserializable]',
])
const DISPLAY_TRUNCATION_PATTERN = /\.\.\. \[truncated \d+ chars\]$/
const EXTERNAL_TRACE_MARKER_KEYS = new Set([
  'hasTraceSpans',
  'traceSpanCount',
  'billingAttribution',
])

export type WorkflowEvalJudgeTraceErrorCode =
  | 'trace_not_found'
  | 'trace_not_finalized'
  | 'trace_invalid'
  | 'trace_too_large'
  | 'selected_output_missing'
  | 'selected_output_incomplete'
  | 'selected_output_too_large'
  | 'tool_call_limit_exceeded'
  | 'tool_value_too_large'
  | 'workflow_judge_input_too_large'
  | 'judge_trace_too_large'

export class WorkflowEvalJudgeTraceError extends Error {
  constructor(
    readonly code: WorkflowEvalJudgeTraceErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowEvalJudgeTraceError'
  }
}

export interface WorkflowEvalTraceCoordinate {
  type: 'loop' | 'parallel'
  containerId: string
  iteration: number
}

export interface WorkflowEvalJudgeBlockOccurrence {
  blockId: string
  name: string
  type: string
  occurrence: number
  executionOrder: number
  status: 'success' | 'error'
  errorHandled: boolean
  startTime: string
  endTime: string
  durationMs: number
  coordinates: WorkflowEvalTraceCoordinate[]
}

export interface WorkflowEvalSelectedOutputOccurrence {
  occurrence: number
  executionOrder: number
  coordinates: WorkflowEvalTraceCoordinate[]
  value: unknown
}

export interface WorkflowEvalJudgeSelectedOutput {
  blockId: string
  path: string
  occurrences: WorkflowEvalSelectedOutputOccurrence[]
}

export interface WorkflowEvalJudgeToolCall {
  ordinal: number
  name: string
  status: 'success' | 'error'
  startTime: string
  endTime: string
  durationMs: number
  input?: unknown
  output?: unknown
  error?: string
}

export interface WorkflowEvalJudgeAgentToolCalls {
  blockId: string
  occurrence: number
  executionOrder: number
  coordinates: WorkflowEvalTraceCoordinate[]
  calls: WorkflowEvalJudgeToolCall[]
}

export interface WorkflowEvalJudgeTrace {
  spanCount: number
  blocks: WorkflowEvalJudgeBlockOccurrence[]
  selectedOutputs: WorkflowEvalJudgeSelectedOutput[]
  agentToolCalls: WorkflowEvalJudgeAgentToolCalls[]
}

export interface WorkflowEvalCodeBlockOutputProjection {
  spanCount: number
  blockOutputs: WorkflowEvalJudgeSelectedOutput[]
}

export interface FinalizedWorkflowEvalTrace {
  traceSpans: TraceSpan[]
  expectedSpanCount: number
  workflowInput: unknown
}

export interface WorkflowEvalJudgeInputProjection {
  spanCount: number
  input: Record<string, unknown>
}

export interface WorkflowEvalJudgeScoreProjection {
  spanCount: number
  value: unknown
}

export interface LoadFinalizedWorkflowEvalTraceInput {
  executionId: string
  workflowId: string
  workspaceId: string
  runId: string
  suiteId: string
  testId: string
  testRunId: string
}

interface TraceIterationContainer {
  type: 'loop' | 'parallel'
  containerId: string
  sourceContainerId: string
}

interface TraceTraversalFrame {
  span: TraceSpan
  coordinates: WorkflowEvalTraceCoordinate[]
  iterationContainer: TraceIterationContainer | null
  childWorkflowDepth: number
  selectedAgentOwner: BlockCandidate | null
}

interface BlockCandidate {
  span: TraceSpan
  blockId: string
  childWorkflowDepth: number
  coordinates: WorkflowEvalTraceCoordinate[]
  toolSpans: TraceSpan[]
  occurrence?: number
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecordLike(value) && !Array.isArray(value)
}

function requireBoundedJson(value: unknown, maxBytes: number, owner: string): number {
  try {
    const bytes = getBoundedJsonByteLength(value, maxBytes)
    if (bytes === undefined) {
      throw new WorkflowEvalJudgeTraceError('trace_invalid', `${owner} is not JSON serializable`)
    }
    return bytes
  } catch (error) {
    if (error instanceof WorkflowEvalJudgeTraceError) throw error
    throw new WorkflowEvalJudgeTraceError('trace_invalid', `${owner} is not JSON serializable`)
  }
}

function assertCompleteString(value: string, owner: string): void {
  if (INCOMPLETE_VALUE_MARKERS.has(value) || DISPLAY_TRUNCATION_PATTERN.test(value)) {
    throw new WorkflowEvalJudgeTraceError(
      'selected_output_incomplete',
      `${owner} contains incomplete or failed-redaction data`
    )
  }
}

function cloneAndRedactJudgeValue(value: unknown, owner: string): unknown {
  if (typeof value === 'string') {
    assertCompleteString(value, owner)
    return redactSensitiveValues(value)
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new WorkflowEvalJudgeTraceError(
        'trace_invalid',
        `${owner} contains a non-finite number`
      )
    }
    return value
  }
  if (isLargeValueRef(value)) {
    throw new WorkflowEvalJudgeTraceError(
      'selected_output_incomplete',
      `${owner} contains an unresolved large-value reference`
    )
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneAndRedactJudgeValue(item, `${owner}[${index}]`))
  }
  if (!isPlainRecord(value)) {
    throw new WorkflowEvalJudgeTraceError('trace_invalid', `${owner} is not a JSON value`)
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (DANGEROUS_PATH_SEGMENTS.has(key)) {
      throw new WorkflowEvalJudgeTraceError('trace_invalid', `${owner} contains an unsafe key`)
    }
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_MARKER
      continue
    }
    if (isLargeDataKey(key) && typeof entry === 'string') {
      throw new WorkflowEvalJudgeTraceError(
        'selected_output_incomplete',
        `${owner} contains omitted large data`
      )
    }
    result[key] = cloneAndRedactJudgeValue(entry, `${owner}.${key}`)
  }
  return result
}

function prepareSelectedValue({
  value,
  maxBytes,
  tooLargeCode,
  owner,
}: {
  value: unknown
  maxBytes: number
  tooLargeCode: 'selected_output_too_large' | 'tool_value_too_large'
  owner: string
}): unknown {
  const rawBytes = requireBoundedJson(value, maxBytes, owner)
  if (rawBytes > maxBytes) {
    throw new WorkflowEvalJudgeTraceError(
      tooLargeCode,
      `${owner} exceeds ${maxBytes} serialized bytes`
    )
  }
  let redacted: unknown
  try {
    redacted = cloneAndRedactJudgeValue(value, owner)
  } catch (error) {
    if (error instanceof WorkflowEvalJudgeTraceError) throw error
    throw new WorkflowEvalJudgeTraceError('trace_invalid', `${owner} could not be redacted safely`)
  }
  const redactedBytes = requireBoundedJson(redacted, maxBytes, owner)
  if (redactedBytes > maxBytes) {
    throw new WorkflowEvalJudgeTraceError(
      tooLargeCode,
      `${owner} exceeds ${maxBytes} serialized bytes after redaction`
    )
  }
  return redacted
}

function parsePathSegments(path: string): string[] {
  return path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
}

function assertSafePath(path: string, owner: string): void {
  if (parsePathSegments(path).some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))) {
    throw new WorkflowEvalJudgeTraceError('trace_invalid', `${owner} contains an unsafe path`)
  }
}

function assertSafeSelector(selector: WorkflowEvalOutputSelector): void {
  assertSafePath(selector.path, `Output selector ${selector.blockId}`)
}

function requireSpanStructure(span: TraceSpan): void {
  if (
    typeof span.id !== 'string' ||
    span.id.length === 0 ||
    typeof span.name !== 'string' ||
    span.name.length === 0 ||
    typeof span.type !== 'string' ||
    span.type.length === 0 ||
    !Number.isFinite(span.duration) ||
    span.duration < 0 ||
    !Number.isFinite(Date.parse(span.startTime)) ||
    !Number.isFinite(Date.parse(span.endTime))
  ) {
    throw new WorkflowEvalJudgeTraceError('trace_invalid', 'Trace contains a malformed span')
  }
  if (new Date(span.endTime).getTime() < new Date(span.startTime).getTime()) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Trace span ${span.id} ends before it starts`
    )
  }
  if (span.children !== undefined && !Array.isArray(span.children)) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Trace span ${span.id} has malformed children`
    )
  }
}

function requireBlockStructure(span: TraceSpan): asserts span is TraceSpan & {
  blockId: string
  executionOrder: number
  status: 'success' | 'error'
} {
  if (
    typeof span.blockId !== 'string' ||
    span.blockId.length === 0 ||
    !Number.isInteger(span.executionOrder) ||
    (span.executionOrder ?? -1) < 0 ||
    (span.status !== 'success' && span.status !== 'error')
  ) {
    throw new WorkflowEvalJudgeTraceError('trace_invalid', `Block span ${span.id} is malformed`)
  }
}

function deriveFallbackCoordinates(span: TraceSpan): WorkflowEvalTraceCoordinate[] {
  const coordinates: WorkflowEvalTraceCoordinate[] = []
  for (const parent of span.parentIterations ?? []) {
    if (parent.iterationType !== 'loop' && parent.iterationType !== 'parallel') continue
    coordinates.push({
      type: parent.iterationType,
      containerId: stripCloneSuffixes(parent.iterationContainerId),
      iteration: parent.iterationCurrent,
    })
  }

  const type = span.parallelId ? 'parallel' : span.loopId ? 'loop' : null
  const containerId = span.parallelId ?? span.loopId
  if (type && containerId && span.iterationIndex !== undefined) {
    const normalizedContainerId = stripCloneSuffixes(containerId)
    const last = coordinates.at(-1)
    if (
      !last ||
      last.type !== type ||
      last.containerId !== normalizedContainerId ||
      last.iteration !== span.iterationIndex
    ) {
      coordinates.push({
        type,
        containerId: normalizedContainerId,
        iteration: span.iterationIndex,
      })
    }
  }
  return coordinates
}

function getSyntheticContainer(span: TraceSpan): TraceIterationContainer | null {
  if (span.blockId || (span.type !== 'loop' && span.type !== 'parallel')) return null
  const prefix = span.type === 'loop' ? 'loop-execution-' : 'parallel-execution-'
  if (!span.id.startsWith(prefix) || span.id.length === prefix.length) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Synthetic ${span.type} span ${span.id} has an invalid identifier`
    )
  }
  const sourceContainerId = span.id.slice(prefix.length)
  return {
    type: span.type,
    containerId: stripCloneSuffixes(sourceContainerId),
    sourceContainerId,
  }
}

function getIterationCoordinate(
  span: TraceSpan,
  container: TraceIterationContainer | null
): WorkflowEvalTraceCoordinate | null {
  if (span.blockId || (span.type !== 'loop-iteration' && span.type !== 'parallel-iteration')) {
    return null
  }
  if (!container || `${container.type}-iteration` !== span.type) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Iteration span ${span.id} is missing its ${span.type} container`
    )
  }
  const prefix = `${container.sourceContainerId}-iteration-`
  if (!span.id.startsWith(prefix)) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Iteration span ${span.id} does not match its container`
    )
  }
  const iteration = Number(span.id.slice(prefix.length))
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Iteration span ${span.id} has an invalid iteration index`
    )
  }
  return { type: container.type, containerId: container.containerId, iteration }
}

function compareBlockCandidates(a: BlockCandidate, b: BlockCandidate): number {
  const orderDelta = (a.span.executionOrder ?? 0) - (b.span.executionOrder ?? 0)
  if (orderDelta !== 0) return orderDelta
  const timeDelta = new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime()
  if (timeDelta !== 0) return timeDelta
  return a.span.id.localeCompare(b.span.id)
}

function collectLatestCompletedTopLevelOutputs(
  traceSpans: readonly TraceSpan[],
  selectedBlockIds: ReadonlySet<string>
): { spanCount: number; latestByBlockId: Map<string, BlockCandidate> } {
  const latestByBlockId = new Map<string, BlockCandidate>()
  const stack: Array<{
    span: TraceSpan
    childWorkflowDepth: number
    iterationContainer: TraceIterationContainer | null
  }> = []
  for (let index = traceSpans.length - 1; index >= 0; index--) {
    const span = traceSpans[index]
    if (span) stack.push({ span, childWorkflowDepth: 0, iterationContainer: null })
  }

  let spanCount = 0
  while (stack.length > 0) {
    const frame = stack.pop()
    if (!frame) break
    const { span } = frame
    spanCount++
    if (spanCount > MAX_WORKFLOW_EVAL_TRACE_SPANS) {
      throw new WorkflowEvalJudgeTraceError(
        'trace_too_large',
        `Trace exceeds ${MAX_WORKFLOW_EVAL_TRACE_SPANS} spans`
      )
    }
    requireSpanStructure(span)

    if (span.blockId !== undefined) {
      requireBlockStructure(span)
      const blockId = stripCloneSuffixes(span.blockId)
      if (
        frame.childWorkflowDepth === 0 &&
        span.status === 'success' &&
        selectedBlockIds.has(blockId)
      ) {
        const candidate: BlockCandidate = {
          span,
          blockId,
          childWorkflowDepth: 0,
          coordinates: [],
          toolSpans: [],
        }
        const current = latestByBlockId.get(blockId)
        if (!current || compareBlockCandidates(current, candidate) < 0) {
          latestByBlockId.set(blockId, candidate)
        }
      }
    }

    const syntheticContainer = getSyntheticContainer(span)
    const iterationCoordinate = getIterationCoordinate(span, frame.iterationContainer)
    const childContainer =
      syntheticContainer ?? (iterationCoordinate ? null : frame.iterationContainer)
    const entersChildWorkflow = span.blockId !== undefined && isWorkflowBlockType(span.type)
    const childWorkflowDepth = frame.childWorkflowDepth + (entersChildWorkflow ? 1 : 0)
    const children = span.children ?? []
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]
      if (child) {
        stack.push({ span: child, childWorkflowDepth, iterationContainer: childContainer })
      }
    }
  }

  return { spanCount, latestByBlockId }
}

function selectWorkflowJudgeValue({
  candidate,
  selector,
  owner,
}: {
  candidate: BlockCandidate | undefined
  selector: WorkflowEvalOutputSelector
  owner: string
}): unknown {
  assertSafeSelector(selector)
  if (!candidate) {
    throw new WorkflowEvalJudgeTraceError(
      'selected_output_missing',
      `${owner} block ${selector.blockId} has no completed top-level occurrence`
    )
  }
  const value = selector.path
    ? pluckByPath(candidate.span.output, selector.path)
    : candidate.span.output
  if (value === undefined) {
    throw new WorkflowEvalJudgeTraceError(
      'selected_output_missing',
      `${owner} ${selector.blockId}${selector.path ? `.${selector.path}` : ''} is missing`
    )
  }
  return prepareSelectedValue({
    value,
    maxBytes: MAX_WORKFLOW_EVAL_SELECTED_OUTPUT_BYTES,
    tooLargeCode: 'selected_output_too_large',
    owner,
  })
}

function buildToolCall(span: TraceSpan, ordinal: number, owner: string): WorkflowEvalJudgeToolCall {
  requireSpanStructure(span)
  if (span.type !== 'tool' || (span.status !== 'success' && span.status !== 'error')) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `${owner} contains a malformed tool span`
    )
  }

  const toolCall: WorkflowEvalJudgeToolCall = {
    ordinal,
    name: redactSensitiveValues(span.name),
    status: span.status,
    startTime: span.startTime,
    endTime: span.endTime,
    durationMs: span.duration,
  }
  if (span.input !== undefined) {
    toolCall.input = prepareSelectedValue({
      value: span.input,
      maxBytes: MAX_WORKFLOW_EVAL_TOOL_VALUE_BYTES,
      tooLargeCode: 'tool_value_too_large',
      owner: `${owner} input`,
    })
  }
  if (span.output !== undefined) {
    toolCall.output = prepareSelectedValue({
      value: span.output,
      maxBytes: MAX_WORKFLOW_EVAL_TOOL_VALUE_BYTES,
      tooLargeCode: 'tool_value_too_large',
      owner: `${owner} output`,
    })
  }
  if (span.errorMessage !== undefined) {
    toolCall.error = prepareSelectedValue({
      value: span.errorMessage,
      maxBytes: MAX_WORKFLOW_EVAL_TOOL_VALUE_BYTES,
      tooLargeCode: 'tool_value_too_large',
      owner: `${owner} error`,
    }) as string
  }
  return toolCall
}

function getMaterializedExecutionData(
  executionData: Record<string, unknown>,
  input: Pick<LoadFinalizedWorkflowEvalTraceInput, 'executionId' | 'workflowId' | 'workspaceId'>
): Promise<Record<string, unknown>> {
  const ref = executionData[TRACE_STORE_REF_KEY]
  if (ref === undefined) return Promise.resolve(executionData)
  if (!isLargeValueRef(ref)) {
    throw new WorkflowEvalJudgeTraceError('trace_invalid', 'Execution trace pointer is malformed')
  }
  if (ref.size > MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_too_large',
      `Execution trace exceeds ${MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES} serialized bytes`
    )
  }
  const markerKeys = Object.keys(executionData).filter((key) => key !== TRACE_STORE_REF_KEY)
  if (markerKeys.some((key) => !EXTERNAL_TRACE_MARKER_KEYS.has(key))) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      'Externalized execution trace contains unexpected inline data'
    )
  }

  return materializeLargeValueRef(ref, {
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    executionId: input.executionId,
    maxBytes: MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES,
    trackReference: false,
  }).then((materialized) => {
    if (!isPlainRecord(materialized)) {
      throw new WorkflowEvalJudgeTraceError(
        'trace_invalid',
        'Execution trace payload could not be materialized'
      )
    }
    const { [TRACE_STORE_REF_KEY]: _pointer, ...markers } = executionData
    return { ...materialized, ...markers }
  })
}

/** Loads the exact terminal Eval execution trace and rejects every degraded log shape. */
export async function loadFinalizedWorkflowEvalTrace(
  input: LoadFinalizedWorkflowEvalTraceInput
): Promise<FinalizedWorkflowEvalTrace> {
  const [row] = await db
    .select({
      status: workflowExecutionLogs.status,
      endedAt: workflowExecutionLogs.endedAt,
      executionDataBytes: sql<number>`octet_length(${workflowExecutionLogs.executionData}::text)::double precision`,
      executionData: sql<unknown>`CASE
        WHEN octet_length(${workflowExecutionLogs.executionData}::text) <= ${MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES}
        THEN ${workflowExecutionLogs.executionData}
        ELSE NULL
      END`,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, input.executionId),
        eq(workflowExecutionLogs.workflowId, input.workflowId),
        eq(workflowExecutionLogs.workspaceId, input.workspaceId)
      )
    )
    .limit(1)

  if (!row) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_not_found',
      `Finalized trace for execution ${input.executionId} was not found`
    )
  }
  if (row.status !== 'completed' || row.endedAt === null) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_not_finalized',
      `Execution ${input.executionId} is not finalized successfully`
    )
  }
  if (
    row.executionDataBytes > MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES ||
    !isPlainRecord(row.executionData)
  ) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_too_large',
      `Execution trace exceeds ${MAX_WORKFLOW_EVAL_SOURCE_TRACE_BYTES} serialized bytes`
    )
  }

  const executionData = await getMaterializedExecutionData(row.executionData, input)
  if (
    executionData.finalizationPath !== 'completed' ||
    executionData.completionFailure !== undefined ||
    executionData.executionDataTruncated === true
  ) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_not_finalized',
      `Execution ${input.executionId} does not contain a complete finalized trace`
    )
  }

  const correlation = executionData.correlation
  if (
    !isPlainRecord(correlation) ||
    correlation.source !== 'eval' ||
    correlation.executionId !== input.executionId ||
    correlation.workflowId !== input.workflowId ||
    correlation.evalRunId !== input.runId ||
    correlation.evalSuiteId !== input.suiteId ||
    correlation.evalTestId !== input.testId ||
    correlation.evalTestRunId !== input.testRunId
  ) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Execution ${input.executionId} has mismatched Eval correlation metadata`
    )
  }

  const expectedSpanCount = executionData.traceSpanCount
  if (
    executionData.hasTraceSpans !== true ||
    !Number.isInteger(expectedSpanCount) ||
    (expectedSpanCount as number) <= 0 ||
    (expectedSpanCount as number) > MAX_WORKFLOW_EVAL_TRACE_SPANS ||
    !Array.isArray(executionData.traceSpans)
  ) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Execution ${input.executionId} has missing or invalid trace spans`
    )
  }

  return {
    traceSpans: executionData.traceSpans as TraceSpan[],
    expectedSpanCount: expectedSpanCount as number,
    workflowInput: executionData.workflowInput,
  }
}

/** Resolves only explicit workflow-judge Start inputs from a finalized subject trace. */
export function projectWorkflowEvalJudgeInput(
  traceSpans: readonly TraceSpan[],
  testInput: unknown,
  mappings: readonly WorkflowEvalWorkflowInputMapping[]
): WorkflowEvalJudgeInputProjection {
  const selectedBlockIds = new Set(
    mappings.flatMap((mapping) =>
      mapping.source.type === 'subjectOutput' ? [mapping.source.blockId] : []
    )
  )
  const { spanCount, latestByBlockId } = collectLatestCompletedTopLevelOutputs(
    traceSpans,
    selectedBlockIds
  )
  const input: Record<string, unknown> = {}

  for (const mapping of mappings) {
    if (DANGEROUS_PATH_SEGMENTS.has(mapping.inputName) || Object.hasOwn(input, mapping.inputName)) {
      throw new WorkflowEvalJudgeTraceError(
        'trace_invalid',
        `Workflow judge input mapping ${mapping.inputName} is unsafe or duplicated`
      )
    }

    if (mapping.source.type === 'subjectOutput') {
      input[mapping.inputName] = selectWorkflowJudgeValue({
        candidate: latestByBlockId.get(mapping.source.blockId),
        selector: mapping.source,
        owner: `Workflow judge input ${mapping.inputName}`,
      })
      continue
    }

    assertSafePath(mapping.source.path, `Workflow judge input ${mapping.inputName}`)
    const value = mapping.source.path ? pluckByPath(testInput, mapping.source.path) : testInput
    if (value === undefined) {
      throw new WorkflowEvalJudgeTraceError(
        'selected_output_missing',
        `Workflow judge test input ${mapping.source.path || '<root>'} is missing`
      )
    }
    input[mapping.inputName] = prepareSelectedValue({
      value,
      maxBytes: MAX_WORKFLOW_EVAL_SELECTED_OUTPUT_BYTES,
      tooLargeCode: 'selected_output_too_large',
      owner: `Workflow judge input ${mapping.inputName}`,
    })
  }

  const inputBytes = requireBoundedJson(
    input,
    MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES,
    'Workflow judge input'
  )
  if (inputBytes > MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES) {
    throw new WorkflowEvalJudgeTraceError(
      'workflow_judge_input_too_large',
      `Workflow judge input exceeds ${MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES} serialized bytes`
    )
  }
  return { spanCount, input }
}

/** Resolves a judge workflow's raw score from its latest completed top-level block occurrence. */
export function projectWorkflowEvalJudgeScore(
  traceSpans: readonly TraceSpan[],
  selector: WorkflowEvalOutputSelector
): WorkflowEvalJudgeScoreProjection {
  const { spanCount, latestByBlockId } = collectLatestCompletedTopLevelOutputs(
    traceSpans,
    new Set([selector.blockId])
  )
  return {
    spanCount,
    value: selectWorkflowJudgeValue({
      candidate: latestByBlockId.get(selector.blockId),
      selector,
      owner: 'Workflow judge score output',
    }),
  }
}

interface TraceEvidenceProjectionOptions {
  allowUnexecutedSelectedBlocks: boolean
  includeAgentToolCalls: boolean
}

function projectTraceEvidence(
  traceSpans: readonly TraceSpan[],
  selectors: readonly WorkflowEvalOutputSelector[],
  options: TraceEvidenceProjectionOptions
): WorkflowEvalJudgeTrace {
  for (const selector of selectors) assertSafeSelector(selector)
  const selectedBlockIds = new Set(selectors.map((selector) => selector.blockId))
  const candidates: BlockCandidate[] = []
  const stack: TraceTraversalFrame[] = []
  for (let index = traceSpans.length - 1; index >= 0; index--) {
    const span = traceSpans[index]
    if (!span) continue
    stack.push({
      span,
      coordinates: [],
      iterationContainer: null,
      childWorkflowDepth: 0,
      selectedAgentOwner: null,
    })
  }

  let spanCount = 0
  while (stack.length > 0) {
    const frame = stack.pop()
    if (!frame) break
    const { span } = frame
    spanCount++
    if (spanCount > MAX_WORKFLOW_EVAL_TRACE_SPANS) {
      throw new WorkflowEvalJudgeTraceError(
        'trace_too_large',
        `Trace exceeds ${MAX_WORKFLOW_EVAL_TRACE_SPANS} spans`
      )
    }
    requireSpanStructure(span)

    let selectedAgentOwner = frame.selectedAgentOwner
    let candidate: BlockCandidate | null = null
    if (span.blockId !== undefined) {
      requireBlockStructure(span)
      const blockId = stripCloneSuffixes(span.blockId)
      if (frame.childWorkflowDepth === 0) {
        candidate = {
          span,
          blockId,
          childWorkflowDepth: frame.childWorkflowDepth,
          coordinates:
            frame.coordinates.length > 0 ? frame.coordinates : deriveFallbackCoordinates(span),
          toolSpans: [],
        }
        candidates.push(candidate)
        if (
          options.includeAgentToolCalls &&
          selectedBlockIds.has(blockId) &&
          isAgentBlockType(span.type)
        ) {
          selectedAgentOwner = candidate
        }
      }
    } else if (span.type === 'tool' && selectedAgentOwner) {
      selectedAgentOwner.toolSpans.push(span)
    }

    const syntheticContainer = getSyntheticContainer(span)
    const iterationCoordinate = getIterationCoordinate(span, frame.iterationContainer)
    const childCoordinates = iterationCoordinate
      ? [...frame.coordinates, iterationCoordinate]
      : frame.coordinates
    const childContainer =
      syntheticContainer ?? (iterationCoordinate ? null : frame.iterationContainer)
    const entersChildWorkflow = span.blockId !== undefined && isWorkflowBlockType(span.type)
    const childWorkflowDepth = frame.childWorkflowDepth + (entersChildWorkflow ? 1 : 0)
    const childSelectedAgentOwner = entersChildWorkflow ? null : selectedAgentOwner
    const children = span.children ?? []
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]
      if (!child) continue
      stack.push({
        span: child,
        coordinates: childCoordinates,
        iterationContainer: childContainer,
        childWorkflowDepth,
        selectedAgentOwner: childSelectedAgentOwner,
      })
    }
  }

  candidates.sort(compareBlockCandidates)
  const occurrenceCounts = new Map<string, number>()
  const blocks: WorkflowEvalJudgeBlockOccurrence[] = []
  for (const candidate of candidates) {
    const occurrence = (occurrenceCounts.get(candidate.blockId) ?? 0) + 1
    occurrenceCounts.set(candidate.blockId, occurrence)
    candidate.occurrence = occurrence
    const span = candidate.span as TraceSpan & {
      executionOrder: number
      status: 'success' | 'error'
    }
    blocks.push({
      blockId: candidate.blockId,
      name: redactSensitiveValues(span.name),
      type: span.type,
      occurrence,
      executionOrder: span.executionOrder,
      status: span.status,
      errorHandled: span.errorHandled === true,
      startTime: span.startTime,
      endTime: span.endTime,
      durationMs: span.duration,
      coordinates: candidate.coordinates,
    })
  }

  const selectedOutputs = selectors.map<WorkflowEvalJudgeSelectedOutput>((selector) => {
    const occurrences: WorkflowEvalSelectedOutputOccurrence[] = []
    for (const candidate of candidates) {
      if (candidate.childWorkflowDepth !== 0 || candidate.blockId !== selector.blockId) continue
      const value = selector.path
        ? pluckByPath(candidate.span.output, selector.path)
        : candidate.span.output
      if (value === undefined) {
        throw new WorkflowEvalJudgeTraceError(
          'selected_output_missing',
          `Selected output ${selector.blockId}${selector.path ? `.${selector.path}` : ''} is missing from occurrence ${candidate.occurrence}`
        )
      }
      occurrences.push({
        occurrence: candidate.occurrence ?? 0,
        executionOrder: candidate.span.executionOrder ?? 0,
        coordinates: candidate.coordinates,
        value: prepareSelectedValue({
          value,
          maxBytes: MAX_WORKFLOW_EVAL_SELECTED_OUTPUT_BYTES,
          tooLargeCode: 'selected_output_too_large',
          owner: `Selected output ${selector.blockId}${selector.path ? `.${selector.path}` : ''} occurrence ${candidate.occurrence}`,
        }),
      })
    }
    if (occurrences.length === 0 && !options.allowUnexecutedSelectedBlocks) {
      throw new WorkflowEvalJudgeTraceError(
        'selected_output_missing',
        `Selected block ${selector.blockId} did not complete at the top level`
      )
    }
    return { blockId: selector.blockId, path: selector.path, occurrences }
  })

  let toolCallCount = 0
  const agentToolCalls: WorkflowEvalJudgeAgentToolCalls[] = []
  for (const candidate of options.includeAgentToolCalls ? candidates : []) {
    if (
      candidate.childWorkflowDepth !== 0 ||
      !selectedBlockIds.has(candidate.blockId) ||
      !isAgentBlockType(candidate.span.type)
    ) {
      continue
    }
    const calls = candidate.toolSpans.map((toolSpan, index) => {
      toolCallCount++
      if (toolCallCount > MAX_WORKFLOW_EVAL_TOOL_CALLS) {
        throw new WorkflowEvalJudgeTraceError(
          'tool_call_limit_exceeded',
          `Selected Agent tool calls exceed ${MAX_WORKFLOW_EVAL_TOOL_CALLS}`
        )
      }
      return buildToolCall(
        toolSpan,
        index + 1,
        `Agent ${candidate.blockId} occurrence ${candidate.occurrence} tool ${index + 1}`
      )
    })
    agentToolCalls.push({
      blockId: candidate.blockId,
      occurrence: candidate.occurrence ?? 0,
      executionOrder: candidate.span.executionOrder ?? 0,
      coordinates: candidate.coordinates,
      calls,
    })
  }

  const projection: WorkflowEvalJudgeTrace = {
    spanCount,
    blocks,
    selectedOutputs,
    agentToolCalls,
  }
  return projection
}

function assertBoundedTraceProjection(value: unknown, owner: string): void {
  const projectionBytes = requireBoundedJson(value, MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES, owner)
  if (projectionBytes > MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES) {
    throw new WorkflowEvalJudgeTraceError(
      'judge_trace_too_large',
      `${owner} exceeds ${MAX_WORKFLOW_EVAL_JUDGE_TRACE_BYTES} serialized bytes`
    )
  }
}

/** Projects a finalized canonical trace into the bounded data an Agent judge may observe. */
export function projectJudgeTrace(
  traceSpans: readonly TraceSpan[],
  selectors: readonly WorkflowEvalOutputSelector[]
): WorkflowEvalJudgeTrace {
  const projection = projectTraceEvidence(traceSpans, selectors, {
    allowUnexecutedSelectedBlocks: false,
    includeAgentToolCalls: true,
  })
  assertBoundedTraceProjection(projection, 'Judge trace projection')
  return projection
}

/** Projects explicitly selected block outputs for deterministic code evaluation. */
export function projectCodeEvaluatorBlockOutputs(
  traceSpans: readonly TraceSpan[],
  selectors: readonly WorkflowEvalOutputSelector[]
): WorkflowEvalCodeBlockOutputProjection {
  const projection = projectTraceEvidence(traceSpans, selectors, {
    allowUnexecutedSelectedBlocks: true,
    includeAgentToolCalls: false,
  })
  const codeProjection = {
    spanCount: projection.spanCount,
    blockOutputs: projection.selectedOutputs,
  }
  assertBoundedTraceProjection(codeProjection, 'Code evaluator block-output projection')
  return codeProjection
}

/** Loads one finalized subject trace and projects it only after its persisted span count matches. */
export async function loadProjectedWorkflowEvalJudgeTrace(
  input: LoadFinalizedWorkflowEvalTraceInput & {
    selectors: readonly WorkflowEvalOutputSelector[]
  }
): Promise<WorkflowEvalJudgeTrace> {
  const { selectors, ...traceInput } = input
  const finalized = await loadFinalizedWorkflowEvalTrace(traceInput)
  const projection = projectJudgeTrace(finalized.traceSpans, selectors)
  if (projection.spanCount !== finalized.expectedSpanCount) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Execution ${input.executionId} projected ${projection.spanCount} spans, expected ${finalized.expectedSpanCount}`
    )
  }
  return projection
}

/** Loads a finalized subject trace and resolves explicitly selected code-evaluator outputs. */
export async function loadProjectedWorkflowEvalCodeBlockOutputs(
  input: LoadFinalizedWorkflowEvalTraceInput & {
    selectors: readonly WorkflowEvalOutputSelector[]
  }
): Promise<WorkflowEvalJudgeSelectedOutput[]> {
  const { selectors, ...traceInput } = input
  const finalized = await loadFinalizedWorkflowEvalTrace(traceInput)
  const projection = projectCodeEvaluatorBlockOutputs(finalized.traceSpans, selectors)
  if (projection.spanCount !== finalized.expectedSpanCount) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Execution ${input.executionId} projected ${projection.spanCount} spans, expected ${finalized.expectedSpanCount}`
    )
  }
  return projection.blockOutputs
}

/** Loads a finalized subject trace and resolves only explicit judge-workflow mappings. */
export async function loadProjectedWorkflowEvalJudgeInput(
  input: LoadFinalizedWorkflowEvalTraceInput & {
    mappings: readonly WorkflowEvalWorkflowInputMapping[]
  }
): Promise<Record<string, unknown>> {
  const { mappings, ...traceInput } = input
  const finalized = await loadFinalizedWorkflowEvalTrace(traceInput)
  const projection = projectWorkflowEvalJudgeInput(
    finalized.traceSpans,
    finalized.workflowInput,
    mappings
  )
  if (projection.spanCount !== finalized.expectedSpanCount) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Execution ${input.executionId} projected ${projection.spanCount} spans, expected ${finalized.expectedSpanCount}`
    )
  }
  return projection.input
}

/** Loads a finalized judge trace and resolves its configured raw score output. */
export async function loadProjectedWorkflowEvalJudgeScore(
  input: LoadFinalizedWorkflowEvalTraceInput & { selector: WorkflowEvalOutputSelector }
): Promise<unknown> {
  const { selector, ...traceInput } = input
  const finalized = await loadFinalizedWorkflowEvalTrace(traceInput)
  const projection = projectWorkflowEvalJudgeScore(finalized.traceSpans, selector)
  if (projection.spanCount !== finalized.expectedSpanCount) {
    throw new WorkflowEvalJudgeTraceError(
      'trace_invalid',
      `Execution ${input.executionId} projected ${projection.spanCount} spans, expected ${finalized.expectedSpanCount}`
    )
  }
  return projection.value
}
