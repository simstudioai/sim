// AUTO-GENERATED FILE. DO NOT EDIT.
//

/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1Outcome".
 */
export type RequestTraceV1Outcome = 'success' | 'error' | 'cancelled'
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1SpanSource".
 */
export type RequestTraceV1SpanSource = 'sim' | 'go'
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1SpanStatus".
 */
export type RequestTraceV1SpanStatus = 'ok' | 'error' | 'cancelled' | 'pending'

/**
 * Trace report sent from Sim to Go after a request completes.
 */
export interface RequestTraceV1SimReport {
  chatId?: string
  cost?: RequestTraceV1CostSummary
  durationMs: number
  endMs: number
  executionId?: string
  goTraceId?: string
  outcome: RequestTraceV1Outcome
  runId?: string
  simRequestId: string
  spans: RequestTraceV1Span[]
  startMs: number
  streamId?: string
  usage?: RequestTraceV1UsageSummary
  userMessage?: string
}
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1CostSummary".
 */
export interface RequestTraceV1CostSummary {
  billedTotalCost?: number
  rawTotalCost?: number
}
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1Span".
 */
export interface RequestTraceV1Span {
  attributes?: MothershipStreamV1AdditionalPropertiesMap
  durationMs: number
  endMs: number
  kind?: string
  name: string
  parentName?: string
  source?: RequestTraceV1SpanSource
  startMs: number
  status: RequestTraceV1SpanStatus
}
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "MothershipStreamV1AdditionalPropertiesMap".
 */
export interface MothershipStreamV1AdditionalPropertiesMap {
  [k: string]: unknown
}
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1UsageSummary".
 */
export interface RequestTraceV1UsageSummary {
  cacheReadTokens?: number
  cacheWriteTokens?: number
  inputTokens?: number
  outputTokens?: number
}
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1MergedTrace".
 */
export interface RequestTraceV1MergedTrace {
  chatId?: string
  cost?: RequestTraceV1CostSummary
  durationMs: number
  endMs: number
  goTraceId: string
  outcome: RequestTraceV1Outcome
  serviceCharges?: MothershipStreamV1AdditionalPropertiesMap
  simRequestId?: string
  spans: RequestTraceV1Span[]
  startMs: number
  streamId?: string
  usage?: RequestTraceV1UsageSummary
  userId?: string
}
/**
 * This interface was referenced by `RequestTraceV1SimReport`'s JSON-Schema
 * via the `definition` "RequestTraceV1SimReport".
 */
export interface RequestTraceV1SimReport1 {
  chatId?: string
  cost?: RequestTraceV1CostSummary
  durationMs: number
  endMs: number
  executionId?: string
  goTraceId?: string
  outcome: RequestTraceV1Outcome
  runId?: string
  simRequestId: string
  spans: RequestTraceV1Span[]
  startMs: number
  streamId?: string
  usage?: RequestTraceV1UsageSummary
  userMessage?: string
}

export const RequestTraceV1Outcome = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
} as const

export const RequestTraceV1SpanSource = {
  sim: 'sim',
  go: 'go',
} as const

export const RequestTraceV1SpanStatus = {
  ok: 'ok',
  error: 'error',
  cancelled: 'cancelled',
  pending: 'pending',
} as const
