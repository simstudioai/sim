// AUTO-GENERATED FILE. DO NOT EDIT.
//

/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1EventType".
 */
export type MothershipStreamV1EventType =
  | 'session'
  | 'text'
  | 'tool'
  | 'span'
  | 'resource'
  | 'run'
  | 'error'
  | 'complete'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1AsyncToolRecordStatus".
 */
export type MothershipStreamV1AsyncToolRecordStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'delivered'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1CompletionStatus".
 */
export type MothershipStreamV1CompletionStatus = 'complete' | 'error' | 'cancelled'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ResourceOp".
 */
export type MothershipStreamV1ResourceOp = 'upsert' | 'remove'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1RunKind".
 */
export type MothershipStreamV1RunKind =
  | 'checkpoint_pause'
  | 'resumed'
  | 'compaction_start'
  | 'compaction_done'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1SessionKind".
 */
export type MothershipStreamV1SessionKind = 'trace' | 'chat' | 'title' | 'start'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1SpanKind".
 */
export type MothershipStreamV1SpanKind = 'subagent'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1SpanLifecycleEvent".
 */
export type MothershipStreamV1SpanLifecycleEvent = 'start' | 'end'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1SpanPayloadKind".
 */
export type MothershipStreamV1SpanPayloadKind = 'subagent' | 'structured_result' | 'subagent_result'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1TextChannel".
 */
export type MothershipStreamV1TextChannel = 'assistant' | 'thinking'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ToolExecutor".
 */
export type MothershipStreamV1ToolExecutor = 'go' | 'sim' | 'client'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ToolMode".
 */
export type MothershipStreamV1ToolMode = 'sync' | 'async'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ToolPhase".
 */
export type MothershipStreamV1ToolPhase = 'call' | 'args_delta' | 'result'
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ToolOutcome".
 */
export type MothershipStreamV1ToolOutcome =
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped'
  | 'rejected'

/**
 * Shared execution-oriented mothership stream contract from Go to Sim.
 */
export interface MothershipStreamV1EventEnvelope {
  payload: MothershipStreamV1AdditionalPropertiesMap
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: MothershipStreamV1EventType
  v: number
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1AdditionalPropertiesMap".
 */
export interface MothershipStreamV1AdditionalPropertiesMap {
  [k: string]: unknown
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1StreamScope".
 */
export interface MothershipStreamV1StreamScope {
  agentId?: string
  lane: 'main' | 'subagent'
  parentToolCallId?: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1StreamRef".
 */
export interface MothershipStreamV1StreamRef {
  chatId?: string
  cursor?: string
  streamId: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1Trace".
 */
export interface MothershipStreamV1Trace {
  requestId: string
  spanId?: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1CheckpointPausePayload".
 */
export interface MothershipStreamV1CheckpointPausePayload {
  checkpointId: string
  executionId: string
  pendingToolCallIds: string[]
  runId: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ResumeRequest".
 */
export interface MothershipStreamV1ResumeRequest {
  checkpointId: string
  results: MothershipStreamV1ResumeToolResult[]
  streamId: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ResumeToolResult".
 */
export interface MothershipStreamV1ResumeToolResult {
  error?: string
  output?: unknown
  success: boolean
  toolCallId: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1StreamCursor".
 */
export interface MothershipStreamV1StreamCursor {
  cursor: string
  seq: number
  streamId: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ToolCallDescriptor".
 */
export interface MothershipStreamV1ToolCallDescriptor {
  arguments?: MothershipStreamV1AdditionalPropertiesMap
  argumentsDelta?: string
  executor: MothershipStreamV1ToolExecutor
  mode: MothershipStreamV1ToolMode
  partial?: boolean
  phase: MothershipStreamV1ToolPhase
  requiresConfirmation?: boolean
  toolCallId: string
  toolName: string
}
/**
 * This interface was referenced by `MothershipStreamV1EventEnvelope`'s JSON-Schema
 * via the `definition` "MothershipStreamV1ToolResultPayload".
 */
export interface MothershipStreamV1ToolResultPayload {
  error?: string
  output?: unknown
  success: boolean
}

export const MothershipStreamV1AsyncToolRecordStatus = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  delivered: 'delivered',
} as const

export const MothershipStreamV1CompletionStatus = {
  complete: 'complete',
  error: 'error',
  cancelled: 'cancelled',
} as const

export const MothershipStreamV1EventType = {
  session: 'session',
  text: 'text',
  tool: 'tool',
  span: 'span',
  resource: 'resource',
  run: 'run',
  error: 'error',
  complete: 'complete',
} as const

export const MothershipStreamV1ResourceOp = {
  upsert: 'upsert',
  remove: 'remove',
} as const

export const MothershipStreamV1RunKind = {
  checkpoint_pause: 'checkpoint_pause',
  resumed: 'resumed',
  compaction_start: 'compaction_start',
  compaction_done: 'compaction_done',
} as const

export const MothershipStreamV1SessionKind = {
  trace: 'trace',
  chat: 'chat',
  title: 'title',
  start: 'start',
} as const

export const MothershipStreamV1SpanKind = {
  subagent: 'subagent',
} as const

export const MothershipStreamV1SpanLifecycleEvent = {
  start: 'start',
  end: 'end',
} as const

export const MothershipStreamV1SpanPayloadKind = {
  subagent: 'subagent',
  structured_result: 'structured_result',
  subagent_result: 'subagent_result',
} as const

export const MothershipStreamV1TextChannel = {
  assistant: 'assistant',
  thinking: 'thinking',
} as const

export const MothershipStreamV1ToolExecutor = {
  go: 'go',
  sim: 'sim',
  client: 'client',
} as const

export const MothershipStreamV1ToolMode = {
  sync: 'sync',
  async: 'async',
} as const

export const MothershipStreamV1ToolOutcome = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  skipped: 'skipped',
  rejected: 'rejected',
} as const

export const MothershipStreamV1ToolPhase = {
  call: 'call',
  args_delta: 'args_delta',
  result: 'result',
} as const
