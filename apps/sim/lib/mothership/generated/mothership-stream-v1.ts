// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/mothership-stream-v1.ts
// Regenerate with `bun run contracts:sync` in the worker.

// The mothership-stream-v1 SSE wire: every `data:` frame the worker emits to Sim (each leg
// ends with a literal `data: [DONE]` line), and the vocabulary Sim re-emits to the browser
// (Sim adds `session` chat/title frames of its own).
// The worker's emitter (apps/server/src/protocol/envelope.ts) builds these envelopes, so a
// frame that drifts from what Sim parses fails typecheck. Each discriminant const below is
// checked against its payload union, because Sim's reader accepts exactly the const's values.

import type {
  StreamActivityCheckpoint,
  StreamTextCompletion,
  StreamTextPosition,
  StreamToolDeadline,
  StreamToolReplay,
} from "./protocol";
import type { ResourcePayload } from "./resources";

/** The shell every frame shares. */
export interface MothershipStreamV1Envelope<TType extends string, TPayload> {
  payload: TPayload;
  scope?: MothershipStreamV1StreamScope;
  seq: number;
  stream: MothershipStreamV1StreamRef;
  trace?: MothershipStreamV1Trace;
  ts: string;
  type: TType;
  v: 1;
}

/** Every frame on the wire, one member per payload shape. */
export type MothershipStreamV1EventEnvelope =
  | MothershipStreamV1Envelope<"session", MothershipStreamV1SessionStartPayload>
  | MothershipStreamV1Envelope<"session", MothershipStreamV1SessionChatPayload>
  | MothershipStreamV1Envelope<"session", MothershipStreamV1SessionTitlePayload>
  | MothershipStreamV1Envelope<"text", MothershipStreamV1TextPayload>
  | MothershipStreamV1Envelope<"tool", MothershipStreamV1ToolCallDescriptor>
  | MothershipStreamV1Envelope<"tool", MothershipStreamV1ToolArgsDeltaPayload>
  | MothershipStreamV1Envelope<"tool", MothershipStreamV1ToolResultPayload>
  | MothershipStreamV1Envelope<"span", MothershipStreamV1SubagentSpanPayload>
  | MothershipStreamV1Envelope<"resource", ResourcePayload>
  | MothershipStreamV1Envelope<"run", MothershipStreamV1CheckpointPausePayload>
  | MothershipStreamV1Envelope<"run", MothershipStreamV1CompactionStartPayload>
  | MothershipStreamV1Envelope<"run", MothershipStreamV1CompactionDonePayload>
  | MothershipStreamV1Envelope<"run", MothershipStreamV1SteeringAppliedPayload>
  | MothershipStreamV1Envelope<"run", MothershipStreamV1TaskArmedPayload>
  | MothershipStreamV1Envelope<"run", MothershipStreamV1TaskDeliveredPayload>
  | MothershipStreamV1Envelope<"error", MothershipStreamV1ErrorPayload>
  | MothershipStreamV1Envelope<"complete", MothershipStreamV1CompletePayload>;

/** The payload a frame of `type` carries. */
type PayloadOf<TType extends MothershipStreamV1EventType> = Extract<
  MothershipStreamV1EventEnvelope,
  { type: TType }
>["payload"];

export type MothershipStreamV1TextChannel = "assistant" | "thinking";
/**
 * Where a tool call executes. `go` means the worker executes it: the name is a persisted
 * historical value (stored chat blocks and self-hosted Sims read it), so it stays on the wire.
 */
export type MothershipStreamV1ToolExecutor = "go" | "sim" | "client";
export type MothershipStreamV1ToolMode = "sync" | "async";
export type MothershipStreamV1ToolStatus =
  | "generating"
  | "awaiting_approval"
  | "executing"
  | "success"
  | "error"
  | "cancelled"
  | "skipped"
  | "rejected";
export type MothershipStreamV1CompletionStatus = "complete" | "error" | "cancelled";

export interface MothershipStreamV1StreamScope {
  agentId?: string;
  lane: "subagent";
  parentSpanId?: string;
  parentToolCallId?: string;
  spanId?: string;
}
export interface MothershipStreamV1StreamRef {
  chatId?: string;
  cursor?: string;
  streamId: string;
}
export interface MothershipStreamV1Trace {
  requestId: string;
  spanId?: string;
}

export interface MothershipStreamV1SessionStartPayload {
  data?: MothershipStreamV1SessionStartData;
  kind: "start";
}
export interface MothershipStreamV1SessionStartData {
  responseId?: string;
}
/** Emitted by Sim, not the worker. */
export interface MothershipStreamV1SessionChatPayload {
  chatId: string;
  kind: "chat";
}
/** Emitted by Sim, not the worker. */
export interface MothershipStreamV1SessionTitlePayload {
  kind: "title";
  title: string;
}

export interface MothershipStreamV1TextPayload extends StreamTextPosition {
  channel: MothershipStreamV1TextChannel;
  text: string;
}

export interface MothershipStreamV1ToolCallDescriptor extends StreamToolReplay, StreamToolDeadline {
  activityDescription?: string;
  arguments?: Record<string, unknown>;
  execName?: string;
  executor: MothershipStreamV1ToolExecutor;
  mode: MothershipStreamV1ToolMode;
  partial?: boolean;
  phase: "call";
  status?: MothershipStreamV1ToolStatus;
  toolCallId: string;
  toolName: string;
  ui?: MothershipStreamV1ToolUI;
}
export interface MothershipStreamV1ToolUI {
  clientExecutable?: boolean;
  hidden?: boolean;
  inbandOwned?: boolean;
  internal?: boolean;
  simExecutable?: boolean;
}
/** Draw-only argument text as it generates; never replayed, never dispatched on. */
export interface MothershipStreamV1ToolArgsDeltaPayload {
  argumentsDelta: string;
  phase: "args_delta";
  toolCallId: string;
  toolName: string;
}
export interface MothershipStreamV1ToolResultPayload extends StreamToolReplay {
  error?: string;
  executor: MothershipStreamV1ToolExecutor;
  mode: MothershipStreamV1ToolMode;
  output?: unknown;
  phase: "result";
  status?: MothershipStreamV1ToolStatus;
  success: boolean;
  toolCallId: string;
  toolName: string;
}

/** A subagent lane's display title (on start) or failure (on end). */
export interface MothershipStreamV1SubagentSpanData {
  name?: string;
  error?: string;
}

export interface MothershipStreamV1SubagentSpanPayload {
  agent?: string;
  data?: MothershipStreamV1SubagentSpanData;
  event: "start" | "end";
  kind: "subagent";
}

export interface MothershipStreamV1CheckpointPausePayload extends StreamActivityCheckpoint {
  checkpointId: string;
  executionId: string;
  kind: "checkpoint_pause";
  pendingToolCallIds: string[];
  runId: string;
}
export interface MothershipStreamV1CompactionStartPayload {
  kind: "compaction_start";
}
export interface MothershipStreamV1CompactionDonePayload {
  kind: "compaction_done";
}
/** A steer reached the run's model input (the loss-free ack for POST /api/streams/steer). */
export interface MothershipStreamV1SteeringAppliedPayload {
  /** As in SteerV2Response's `applied`; absent only on frames from workers without steer v2. */
  eventSeq?: number;
  kind: "steering_applied";
  steeringId: string;
  textOffset?: number;
}
export interface MothershipStreamV1TaskArmedPayload {
  kind: "task_armed";
  note: string;
  target: Record<string, unknown>;
  taskId: string;
  taskKind: "timer" | "workflow_run";
}
export interface MothershipStreamV1TaskDeliveredPayload {
  kind: "task_delivered";
  status: "completed" | "failed" | "stopped" | "expired";
  summary: string;
  taskId: string;
}

export interface MothershipStreamV1ErrorPayload {
  code?: string;
  /** Sim-emitted detail (e.g. the replay-gap bounds); the worker sends none. */
  data?: unknown;
  displayMessage?: string;
  /** Sim-emitted alias of `message`; the worker sends none. */
  error?: string;
  message: string;
  provider?: string;
}

export interface MothershipStreamV1CompletePayload extends StreamTextCompletion, StreamActivityCheckpoint {
  cost?: MothershipStreamV1CostData;
  reason?: string;
  response?: unknown;
  status: MothershipStreamV1CompletionStatus;
  usage?: MothershipStreamV1UsageData;
}
export interface MothershipStreamV1CostData {
  input?: number;
  output?: number;
  total?: number;
}
export interface MothershipStreamV1UsageData {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  model?: string;
  output_tokens?: number;
  total_tokens?: number;
}

export type MothershipStreamV1EventType = MothershipStreamV1EventEnvelope["type"];

export const MothershipStreamV1EventType = {
  session: "session",
  text: "text",
  tool: "tool",
  span: "span",
  resource: "resource",
  run: "run",
  error: "error",
  complete: "complete",
} as const satisfies { [K in MothershipStreamV1EventType]: K };

export type MothershipStreamV1SessionKind = PayloadOf<"session">["kind"];

export const MothershipStreamV1SessionKind = {
  chat: "chat",
  title: "title",
  start: "start",
} as const satisfies { [K in MothershipStreamV1SessionKind]: K };

export const MothershipStreamV1TextChannel = {
  assistant: "assistant",
  thinking: "thinking",
} as const satisfies { [K in MothershipStreamV1TextChannel]: K };

export type MothershipStreamV1ToolPhase = PayloadOf<"tool">["phase"];

export const MothershipStreamV1ToolPhase = {
  call: "call",
  args_delta: "args_delta",
  result: "result",
} as const satisfies { [K in MothershipStreamV1ToolPhase]: K };

export const MothershipStreamV1ToolExecutor = {
  go: "go",
  sim: "sim",
  client: "client",
} as const satisfies { [K in MothershipStreamV1ToolExecutor]: K };

export const MothershipStreamV1ToolMode = {
  sync: "sync",
  async: "async",
} as const satisfies { [K in MothershipStreamV1ToolMode]: K };

export const MothershipStreamV1ToolStatus = {
  generating: "generating",
  awaiting_approval: "awaiting_approval",
  executing: "executing",
  success: "success",
  error: "error",
  cancelled: "cancelled",
  skipped: "skipped",
  rejected: "rejected",
} as const satisfies { [K in MothershipStreamV1ToolStatus]: K };

export type MothershipStreamV1SpanPayloadKind = PayloadOf<"span">["kind"];

export const MothershipStreamV1SpanPayloadKind = {
  subagent: "subagent",
} as const satisfies { [K in MothershipStreamV1SpanPayloadKind]: K };

export type MothershipStreamV1SpanLifecycleEvent = PayloadOf<"span">["event"];

export const MothershipStreamV1SpanLifecycleEvent = {
  start: "start",
  end: "end",
} as const satisfies { [K in MothershipStreamV1SpanLifecycleEvent]: K };

export type MothershipStreamV1ResourceOp = ResourcePayload["op"];

export const MothershipStreamV1ResourceOp = {
  upsert: "upsert",
  remove: "remove",
  clear_view: "clear_view",
  refresh: "refresh",
} as const satisfies { [K in MothershipStreamV1ResourceOp]: K };

export type MothershipStreamV1RunKind = PayloadOf<"run">["kind"];

export const MothershipStreamV1RunKind = {
  checkpoint_pause: "checkpoint_pause",
  compaction_start: "compaction_start",
  compaction_done: "compaction_done",
  steering_applied: "steering_applied",
  task_armed: "task_armed",
  task_delivered: "task_delivered",
} as const satisfies { [K in MothershipStreamV1RunKind]: K };

export const MothershipStreamV1CompletionStatus = {
  complete: "complete",
  error: "error",
  cancelled: "cancelled",
} as const satisfies { [K in MothershipStreamV1CompletionStatus]: K };

/** The terminal outcomes Sim reports for a tool call it executed (a subset of the tool status). */
export type MothershipStreamV1ToolOutcome = Extract<
  MothershipStreamV1ToolStatus,
  "success" | "error" | "cancelled" | "skipped" | "rejected"
>;

export const MothershipStreamV1ToolOutcome = {
  success: "success",
  error: "error",
  cancelled: "cancelled",
  skipped: "skipped",
  rejected: "rejected",
} as const satisfies { [K in MothershipStreamV1ToolOutcome]: K };
