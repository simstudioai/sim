// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/trace-events-v1.ts
// Regenerate with `bun run contracts:sync` in the worker.

// Canonical mothership OTel span event names Sim emits. Call sites reference
// `TraceEvent.<Identifier>` rather than raw strings so typos are compile errors.

export const TraceEvent = {
  ContextTransform: "context.transform",
  CopilotDbTransactionBodyComplete: "copilot.db.transaction.body_complete",
  CopilotDbTransactionReady: "copilot.db.transaction.ready",
  CopilotOutputFileError: "copilot.output_file.error",
  CopilotSseFirstEvent: "copilot.sse.first_event",
  CopilotSseIdleGapExceeded: "copilot.sse.idle_gap_exceeded",
  CopilotSseTerminalEventReceived: "copilot.sse.terminal_event_received",
  CopilotTableError: "copilot.table.error",
  CopilotVfsParseFailed: "copilot.vfs.parse_failed",
  CopilotVfsResizeAttempt: "copilot.vfs.resize_attempt",
  CopilotVfsResizeAttemptFailed: "copilot.vfs.resize_attempt_failed",
  GenAiPromptCacheBreakpoint: "gen_ai.prompt_cache.breakpoint",
  LlmInvokeSent: "llm.invoke.sent",
  LlmStreamFirstChunk: "llm.stream.first_chunk",
  LlmStreamOpened: "llm.stream.opened",
  PgNotifyFailed: "pg_notify_failed",
  RedisSubscribed: "redis.subscribed",
  RequestCancelled: "request.cancelled",
} as const;

export type TraceEventKey = keyof typeof TraceEvent;
export type TraceEventValue = (typeof TraceEvent)[TraceEventKey];

/** Readonly sorted list of every canonical event name. */
export const TraceEventValues: readonly TraceEventValue[] = [
  "context.transform",
  "copilot.db.transaction.body_complete",
  "copilot.db.transaction.ready",
  "copilot.output_file.error",
  "copilot.sse.first_event",
  "copilot.sse.idle_gap_exceeded",
  "copilot.sse.terminal_event_received",
  "copilot.table.error",
  "copilot.vfs.parse_failed",
  "copilot.vfs.resize_attempt",
  "copilot.vfs.resize_attempt_failed",
  "gen_ai.prompt_cache.breakpoint",
  "llm.invoke.sent",
  "llm.stream.first_chunk",
  "llm.stream.opened",
  "pg_notify_failed",
  "redis.subscribed",
  "request.cancelled",
] as const;
