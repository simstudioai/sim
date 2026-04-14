// AUTO-GENERATED FILE. DO NOT EDIT.
//

/**
 * Shared execution-oriented mothership stream contract from Go to Sim.
 */
export type MothershipStreamV1EventEnvelope =
  | MothershipStreamV1SessionStartEventEnvelope
  | MothershipStreamV1SessionChatEventEnvelope
  | MothershipStreamV1SessionTitleEventEnvelope
  | MothershipStreamV1SessionTraceEventEnvelope
  | MothershipStreamV1TextEventEnvelope
  | MothershipStreamV1ToolCallEventEnvelope
  | MothershipStreamV1ToolArgsDeltaEventEnvelope
  | MothershipStreamV1ToolResultEventEnvelope
  | MothershipStreamV1SubagentSpanStartEventEnvelope
  | MothershipStreamV1SubagentSpanEndEventEnvelope
  | MothershipStreamV1StructuredResultSpanEventEnvelope
  | MothershipStreamV1SubagentResultSpanEventEnvelope
  | MothershipStreamV1ResourceUpsertEventEnvelope
  | MothershipStreamV1ResourceRemoveEventEnvelope
  | MothershipStreamV1CheckpointPauseEventEnvelope
  | MothershipStreamV1RunResumedEventEnvelope
  | MothershipStreamV1CompactionStartEventEnvelope
  | MothershipStreamV1CompactionDoneEventEnvelope
  | MothershipStreamV1ErrorEventEnvelope
  | MothershipStreamV1CompleteEventEnvelope
export type MothershipStreamV1TextChannel = 'assistant' | 'thinking'
export type MothershipStreamV1ToolExecutor = 'go' | 'sim' | 'client'
export type MothershipStreamV1ToolMode = 'sync' | 'async'
export type MothershipStreamV1ToolStatus =
  | 'generating'
  | 'executing'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped'
  | 'rejected'
export type MothershipStreamV1CompletionStatus = 'complete' | 'error' | 'cancelled'

export interface MothershipStreamV1SessionStartEventEnvelope {
  payload: MothershipStreamV1SessionStartPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'session'
  v: 1
}
export interface MothershipStreamV1SessionStartPayload {
  data?: MothershipStreamV1SessionStartData
  kind: 'start'
}
export interface MothershipStreamV1SessionStartData {
  responseId?: string
}
export interface MothershipStreamV1StreamScope {
  agentId?: string
  lane: 'subagent'
  parentToolCallId?: string
}
export interface MothershipStreamV1StreamRef {
  chatId?: string
  cursor?: string
  streamId: string
}
export interface MothershipStreamV1Trace {
  requestId: string
  spanId?: string
}
export interface MothershipStreamV1SessionChatEventEnvelope {
  payload: MothershipStreamV1SessionChatPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'session'
  v: 1
}
export interface MothershipStreamV1SessionChatPayload {
  chatId: string
  kind: 'chat'
}
export interface MothershipStreamV1SessionTitleEventEnvelope {
  payload: MothershipStreamV1SessionTitlePayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'session'
  v: 1
}
export interface MothershipStreamV1SessionTitlePayload {
  kind: 'title'
  title: string
}
export interface MothershipStreamV1SessionTraceEventEnvelope {
  payload: MothershipStreamV1SessionTracePayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'session'
  v: 1
}
export interface MothershipStreamV1SessionTracePayload {
  kind: 'trace'
  requestId: string
  spanId?: string
}
export interface MothershipStreamV1TextEventEnvelope {
  payload: MothershipStreamV1TextPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'text'
  v: 1
}
export interface MothershipStreamV1TextPayload {
  channel: MothershipStreamV1TextChannel
  text: string
}
export interface MothershipStreamV1ToolCallEventEnvelope {
  payload: MothershipStreamV1ToolCallDescriptor
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'tool'
  v: 1
}
export interface MothershipStreamV1ToolCallDescriptor {
  arguments?: MothershipStreamV1AdditionalPropertiesMap
  executor: MothershipStreamV1ToolExecutor
  mode: MothershipStreamV1ToolMode
  partial?: boolean
  phase: 'call'
  requiresConfirmation?: boolean
  status?: MothershipStreamV1ToolStatus
  toolCallId: string
  toolName: string
  ui?: MothershipStreamV1ToolUI
}
export interface MothershipStreamV1AdditionalPropertiesMap {
  [k: string]: unknown
}
export interface MothershipStreamV1ToolUI {
  clientExecutable?: boolean
  hidden?: boolean
  icon?: string
  internal?: boolean
  phaseLabel?: string
  requiresConfirmation?: boolean
  title?: string
}
export interface MothershipStreamV1ToolArgsDeltaEventEnvelope {
  payload: MothershipStreamV1ToolArgsDeltaPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'tool'
  v: 1
}
export interface MothershipStreamV1ToolArgsDeltaPayload {
  argumentsDelta: string
  executor: MothershipStreamV1ToolExecutor
  mode: MothershipStreamV1ToolMode
  phase: 'args_delta'
  toolCallId: string
  toolName: string
}
export interface MothershipStreamV1ToolResultEventEnvelope {
  payload: MothershipStreamV1ToolResultPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'tool'
  v: 1
}
export interface MothershipStreamV1ToolResultPayload {
  error?: string
  executor: MothershipStreamV1ToolExecutor
  mode: MothershipStreamV1ToolMode
  output?: unknown
  phase: 'result'
  status?: MothershipStreamV1ToolStatus
  success: boolean
  toolCallId: string
  toolName: string
}
export interface MothershipStreamV1SubagentSpanStartEventEnvelope {
  payload: MothershipStreamV1SubagentSpanStartPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'span'
  v: 1
}
export interface MothershipStreamV1SubagentSpanStartPayload {
  agent?: string
  data?: unknown
  event: 'start'
  kind: 'subagent'
}
export interface MothershipStreamV1SubagentSpanEndEventEnvelope {
  payload: MothershipStreamV1SubagentSpanEndPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'span'
  v: 1
}
export interface MothershipStreamV1SubagentSpanEndPayload {
  agent?: string
  data?: unknown
  event: 'end'
  kind: 'subagent'
}
export interface MothershipStreamV1StructuredResultSpanEventEnvelope {
  payload: MothershipStreamV1StructuredResultSpanPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'span'
  v: 1
}
export interface MothershipStreamV1StructuredResultSpanPayload {
  agent?: string
  data?: unknown
  kind: 'structured_result'
}
export interface MothershipStreamV1SubagentResultSpanEventEnvelope {
  payload: MothershipStreamV1SubagentResultSpanPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'span'
  v: 1
}
export interface MothershipStreamV1SubagentResultSpanPayload {
  agent?: string
  data?: unknown
  kind: 'subagent_result'
}
export interface MothershipStreamV1ResourceUpsertEventEnvelope {
  payload: MothershipStreamV1ResourceUpsertPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'resource'
  v: 1
}
export interface MothershipStreamV1ResourceUpsertPayload {
  op: 'upsert'
  resource: MothershipStreamV1ResourceDescriptor
}
export interface MothershipStreamV1ResourceDescriptor {
  id: string
  title?: string
  type: string
}
export interface MothershipStreamV1ResourceRemoveEventEnvelope {
  payload: MothershipStreamV1ResourceRemovePayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'resource'
  v: 1
}
export interface MothershipStreamV1ResourceRemovePayload {
  op: 'remove'
  resource: MothershipStreamV1ResourceDescriptor
}
export interface MothershipStreamV1CheckpointPauseEventEnvelope {
  payload: MothershipStreamV1CheckpointPausePayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'run'
  v: 1
}
export interface MothershipStreamV1CheckpointPausePayload {
  checkpointId: string
  executionId: string
  frames?: MothershipStreamV1CheckpointPauseFrame[]
  kind: 'checkpoint_pause'
  pendingToolCallIds: string[]
  runId: string
}
export interface MothershipStreamV1CheckpointPauseFrame {
  parentToolCallId: string
  parentToolName: string
  pendingToolIds: string[]
}
export interface MothershipStreamV1RunResumedEventEnvelope {
  payload: MothershipStreamV1RunResumedPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'run'
  v: 1
}
export interface MothershipStreamV1RunResumedPayload {
  kind: 'resumed'
}
export interface MothershipStreamV1CompactionStartEventEnvelope {
  payload: MothershipStreamV1CompactionStartPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'run'
  v: 1
}
export interface MothershipStreamV1CompactionStartPayload {
  kind: 'compaction_start'
}
export interface MothershipStreamV1CompactionDoneEventEnvelope {
  payload: MothershipStreamV1CompactionDonePayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'run'
  v: 1
}
export interface MothershipStreamV1CompactionDonePayload {
  data?: MothershipStreamV1CompactionDoneData
  kind: 'compaction_done'
}
export interface MothershipStreamV1CompactionDoneData {
  summary_chars: number
}
export interface MothershipStreamV1ErrorEventEnvelope {
  payload: MothershipStreamV1ErrorPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'error'
  v: 1
}
export interface MothershipStreamV1ErrorPayload {
  code?: string
  data?: unknown
  displayMessage?: string
  error?: string
  message: string
  provider?: string
}
export interface MothershipStreamV1CompleteEventEnvelope {
  payload: MothershipStreamV1CompletePayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'complete'
  v: 1
}
export interface MothershipStreamV1CompletePayload {
  cost?: MothershipStreamV1CostData
  reason?: string
  response?: unknown
  status: MothershipStreamV1CompletionStatus
  usage?: MothershipStreamV1UsageData
}
export interface MothershipStreamV1CostData {
  input?: number
  output?: number
  total?: number
}
export interface MothershipStreamV1UsageData {
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  input_tokens?: number
  model?: string
  output_tokens?: number
  total_tokens?: number
}

export type MothershipStreamV1AsyncToolRecordStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'delivered'

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

export type MothershipStreamV1EventType =
  | 'session'
  | 'text'
  | 'tool'
  | 'span'
  | 'resource'
  | 'run'
  | 'error'
  | 'complete'

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

export type MothershipStreamV1ResourceOp = 'upsert' | 'remove'

export const MothershipStreamV1ResourceOp = {
  upsert: 'upsert',
  remove: 'remove',
} as const

export type MothershipStreamV1RunKind =
  | 'checkpoint_pause'
  | 'resumed'
  | 'compaction_start'
  | 'compaction_done'

export const MothershipStreamV1RunKind = {
  checkpoint_pause: 'checkpoint_pause',
  resumed: 'resumed',
  compaction_start: 'compaction_start',
  compaction_done: 'compaction_done',
} as const

export type MothershipStreamV1SessionKind = 'trace' | 'chat' | 'title' | 'start'

export const MothershipStreamV1SessionKind = {
  trace: 'trace',
  chat: 'chat',
  title: 'title',
  start: 'start',
} as const

export type MothershipStreamV1SpanKind = 'subagent'

export const MothershipStreamV1SpanKind = {
  subagent: 'subagent',
} as const

export type MothershipStreamV1SpanLifecycleEvent = 'start' | 'end'

export const MothershipStreamV1SpanLifecycleEvent = {
  start: 'start',
  end: 'end',
} as const

export type MothershipStreamV1SpanPayloadKind = 'subagent' | 'structured_result' | 'subagent_result'

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

export type MothershipStreamV1ToolOutcome =
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped'
  | 'rejected'

export const MothershipStreamV1ToolOutcome = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  skipped: 'skipped',
  rejected: 'rejected',
} as const

export type MothershipStreamV1ToolPhase = 'call' | 'args_delta' | 'result'

export const MothershipStreamV1ToolPhase = {
  call: 'call',
  args_delta: 'args_delta',
  result: 'result',
} as const

export const MothershipStreamV1ToolStatus = {
  generating: 'generating',
  executing: 'executing',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  skipped: 'skipped',
  rejected: 'rejected',
} as const
