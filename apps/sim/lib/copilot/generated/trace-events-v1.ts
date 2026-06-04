// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/trace-events-v1.schema.json
// Regenerate with: bun run trace-events-contract:generate
//
// Canonical mothership OTel span event names. Call sites should
// reference `TraceEvent.<Identifier>` (e.g.
// `TraceEvent.RequestCancelled`) rather than raw string literals,
// so the Go-side contract is the single source of truth and typos
// become compile errors.

export const TraceEvent = {
  BedrockInvokeRetryWithoutImages: 'bedrock.invoke.retry_without_images',
  CopilotOutputFileError: 'copilot.output_file.error',
  CopilotSseFirstEvent: 'copilot.sse.first_event',
  CopilotSseIdleGapExceeded: 'copilot.sse.idle_gap_exceeded',
  CopilotSseTerminalEventReceived: 'copilot.sse.terminal_event_received',
  CopilotTableError: 'copilot.table.error',
  CopilotVfsParseFailed: 'copilot.vfs.parse_failed',
  CopilotVfsResizeAttempt: 'copilot.vfs.resize_attempt',
  CopilotVfsResizeAttemptFailed: 'copilot.vfs.resize_attempt_failed',
  LlmInvokeSent: 'llm.invoke.sent',
  LlmStreamFirstChunk: 'llm.stream.first_chunk',
  LlmStreamOpened: 'llm.stream.opened',
  PgNotifyFailed: 'pg_notify_failed',
  RedisSubscribed: 'redis.subscribed',
  RequestCancelled: 'request.cancelled',
} as const

export type TraceEventKey = keyof typeof TraceEvent
export type TraceEventValue = (typeof TraceEvent)[TraceEventKey]

/** Readonly sorted list of every canonical event name. */
export const TraceEventValues: readonly TraceEventValue[] = [
  'bedrock.invoke.retry_without_images',
  'copilot.output_file.error',
  'copilot.sse.first_event',
  'copilot.sse.idle_gap_exceeded',
  'copilot.sse.terminal_event_received',
  'copilot.table.error',
  'copilot.vfs.parse_failed',
  'copilot.vfs.resize_attempt',
  'copilot.vfs.resize_attempt_failed',
  'llm.invoke.sent',
  'llm.stream.first_chunk',
  'llm.stream.opened',
  'pg_notify_failed',
  'redis.subscribed',
  'request.cancelled',
] as const
