// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/mothership-stream-v1.ts
// Regenerate with `bun run contracts:sync` in the worker.

// The mothership-stream-v1 SSE wire: every `data:` frame the worker emits to Sim (each leg
// ends with a literal `data: [DONE]` line), and the vocabulary Sim re-emits to the browser
// (Sim adds `session` chat/title frames of its own).
// The zod schemas below are the single source (D122): every type is inferred from them, so the
// worker's emitter (apps/server/src/protocol/envelope.ts) fails typecheck on a frame that drifts,
// and a reader can validate a frame at runtime against the same definition. Each discriminant
// const below is checked against its payload union, because Sim's reader accepts exactly the
// const's values. Objects strip unknown keys: a newer emitter's extra field never fails a reader.
// Its own optional fields are `?: T` (`.exactOptional()`); the protocol.ts fields it spreads
// are `?: T | undefined`.

import { z } from "zod";
import {
  StreamActivityCheckpointSchema,
  StreamTextCompletionSchema,
  StreamTextPositionSchema,
  StreamToolDeadlineSchema,
  StreamToolReplaySchema,
} from "./protocol";
import { ResourcePayload } from "./resources";

// Each value enum's const is its single source; its schema reads the const.

export const MothershipStreamV1TextChannel = {
  assistant: "assistant",
  thinking: "thinking",
} as const;
export type MothershipStreamV1TextChannel =
  (typeof MothershipStreamV1TextChannel)[keyof typeof MothershipStreamV1TextChannel];

/**
 * Where a tool call executes. `go` means the worker executes it: the name is a persisted
 * historical value (stored chat blocks and self-hosted Sims read it), so it stays on the wire.
 */
export const MothershipStreamV1ToolExecutor = {
  go: "go",
  sim: "sim",
  client: "client",
} as const;
export type MothershipStreamV1ToolExecutor =
  (typeof MothershipStreamV1ToolExecutor)[keyof typeof MothershipStreamV1ToolExecutor];

export const MothershipStreamV1ToolMode = {
  sync: "sync",
  async: "async",
} as const;
export type MothershipStreamV1ToolMode =
  (typeof MothershipStreamV1ToolMode)[keyof typeof MothershipStreamV1ToolMode];

export const MothershipStreamV1ToolStatus = {
  generating: "generating",
  awaiting_approval: "awaiting_approval",
  executing: "executing",
  success: "success",
  error: "error",
  cancelled: "cancelled",
  skipped: "skipped",
  rejected: "rejected",
} as const;
export type MothershipStreamV1ToolStatus =
  (typeof MothershipStreamV1ToolStatus)[keyof typeof MothershipStreamV1ToolStatus];

export const MothershipStreamV1SpanLifecycleEvent = {
  start: "start",
  end: "end",
} as const;
export type MothershipStreamV1SpanLifecycleEvent =
  (typeof MothershipStreamV1SpanLifecycleEvent)[keyof typeof MothershipStreamV1SpanLifecycleEvent];

export const MothershipStreamV1CompletionStatus = {
  complete: "complete",
  error: "error",
  cancelled: "cancelled",
} as const;
export type MothershipStreamV1CompletionStatus =
  (typeof MothershipStreamV1CompletionStatus)[keyof typeof MothershipStreamV1CompletionStatus];

const StreamScopeSchema = z.object({
  agentId: z.string().exactOptional(),
  lane: z.literal("subagent"),
  parentSpanId: z.string().exactOptional(),
  parentToolCallId: z.string().exactOptional(),
  spanId: z.string().exactOptional(),
});
export type MothershipStreamV1StreamScope = z.infer<typeof StreamScopeSchema>;

const StreamRefSchema = z.object({
  chatId: z.string().exactOptional(),
  cursor: z.string().exactOptional(),
  streamId: z.string().min(1),
});
export type MothershipStreamV1StreamRef = z.infer<typeof StreamRefSchema>;

const TraceSchema = z.object({
  requestId: z.string(),
  spanId: z.string().exactOptional(),
});
export type MothershipStreamV1Trace = z.infer<typeof TraceSchema>;

const EnvelopeShellSchema = z.object({
  scope: StreamScopeSchema.exactOptional(),
  seq: z.number(),
  stream: StreamRefSchema,
  trace: TraceSchema.exactOptional(),
  ts: z.string(),
  v: z.literal(1),
});

/** The shell every frame shares. */
export interface MothershipStreamV1Envelope<TType extends string, TPayload>
  extends z.infer<typeof EnvelopeShellSchema> {
  payload: TPayload;
  type: TType;
}

const SessionStartDataSchema = z.object({ responseId: z.string().exactOptional() });
export type MothershipStreamV1SessionStartData = z.infer<typeof SessionStartDataSchema>;

const SessionStartPayloadSchema = z.object({
  data: SessionStartDataSchema.exactOptional(),
  kind: z.literal("start"),
});
export type MothershipStreamV1SessionStartPayload = z.infer<typeof SessionStartPayloadSchema>;

/** Emitted by Sim, not the worker. */
const SessionChatPayloadSchema = z.object({ chatId: z.string(), kind: z.literal("chat") });
export type MothershipStreamV1SessionChatPayload = z.infer<typeof SessionChatPayloadSchema>;

/** Emitted by Sim, not the worker. */
const SessionTitlePayloadSchema = z.object({ kind: z.literal("title"), title: z.string() });
export type MothershipStreamV1SessionTitlePayload = z.infer<typeof SessionTitlePayloadSchema>;

const TextPayloadSchema = z.object({
  ...StreamTextPositionSchema.shape,
  channel: z.enum(MothershipStreamV1TextChannel),
  text: z.string(),
});
export type MothershipStreamV1TextPayload = z.infer<typeof TextPayloadSchema>;

const ToolUISchema = z.object({
  clientExecutable: z.boolean().exactOptional(),
  hidden: z.boolean().exactOptional(),
  inbandOwned: z.boolean().exactOptional(),
  internal: z.boolean().exactOptional(),
  simExecutable: z.boolean().exactOptional(),
});
export type MothershipStreamV1ToolUI = z.infer<typeof ToolUISchema>;

const ToolCallDescriptorSchema = z.object({
  ...StreamToolReplaySchema.shape,
  ...StreamToolDeadlineSchema.shape,
  activityDescription: z.string().exactOptional(),
  arguments: z.record(z.string(), z.unknown()).exactOptional(),
  execName: z.string().exactOptional(),
  executor: z.enum(MothershipStreamV1ToolExecutor),
  mode: z.enum(MothershipStreamV1ToolMode),
  partial: z.boolean().exactOptional(),
  phase: z.literal("call"),
  status: z.enum(MothershipStreamV1ToolStatus).exactOptional(),
  toolCallId: z.string(),
  toolName: z.string(),
  ui: ToolUISchema.exactOptional(),
});
export type MothershipStreamV1ToolCallDescriptor = z.infer<typeof ToolCallDescriptorSchema>;

/** Draw-only argument text as it generates; never replayed, never dispatched on. */
const ToolArgsDeltaPayloadSchema = z.object({
  argumentsDelta: z.string(),
  phase: z.literal("args_delta"),
  toolCallId: z.string(),
  toolName: z.string(),
});
export type MothershipStreamV1ToolArgsDeltaPayload = z.infer<typeof ToolArgsDeltaPayloadSchema>;

const ToolResultPayloadSchema = z.object({
  ...StreamToolReplaySchema.shape,
  error: z.string().exactOptional(),
  executor: z.enum(MothershipStreamV1ToolExecutor),
  mode: z.enum(MothershipStreamV1ToolMode),
  output: z.unknown().exactOptional(),
  phase: z.literal("result"),
  status: z.enum(MothershipStreamV1ToolStatus).exactOptional(),
  success: z.boolean(),
  toolCallId: z.string(),
  toolName: z.string(),
});
export type MothershipStreamV1ToolResultPayload = z.infer<typeof ToolResultPayloadSchema>;

/** A subagent lane's display title (on start) or failure (on end). */
const SubagentSpanDataSchema = z.object({
  name: z.string().exactOptional(),
  error: z.string().exactOptional(),
});
export type MothershipStreamV1SubagentSpanData = z.infer<typeof SubagentSpanDataSchema>;

const SubagentSpanPayloadSchema = z.object({
  agent: z.string().exactOptional(),
  data: SubagentSpanDataSchema.exactOptional(),
  event: z.enum(MothershipStreamV1SpanLifecycleEvent),
  kind: z.literal("subagent"),
});
export type MothershipStreamV1SubagentSpanPayload = z.infer<typeof SubagentSpanPayloadSchema>;

const CheckpointPausePayloadSchema = z.object({
  ...StreamActivityCheckpointSchema.shape,
  checkpointId: z.string(),
  executionId: z.string(),
  kind: z.literal("checkpoint_pause"),
  pendingToolCallIds: z.array(z.string()),
  runId: z.string(),
});
export type MothershipStreamV1CheckpointPausePayload = z.infer<typeof CheckpointPausePayloadSchema>;

const CompactionStartPayloadSchema = z.object({ kind: z.literal("compaction_start") });
export type MothershipStreamV1CompactionStartPayload = z.infer<typeof CompactionStartPayloadSchema>;

const CompactionDonePayloadSchema = z.object({ kind: z.literal("compaction_done") });
export type MothershipStreamV1CompactionDonePayload = z.infer<typeof CompactionDonePayloadSchema>;

/**
 * A steer reached the run's model input (the loss-free ack for POST /api/streams/steer).
 * `eventSeq` is as in SteerV2Response's `applied`; absent only on frames from workers without
 * steer v2.
 */
const SteeringAppliedPayloadSchema = z.object({
  eventSeq: z.number().exactOptional(),
  kind: z.literal("steering_applied"),
  steeringId: z.string(),
  textOffset: z.number().exactOptional(),
});
export type MothershipStreamV1SteeringAppliedPayload = z.infer<typeof SteeringAppliedPayloadSchema>;

const TaskArmedPayloadSchema = z.object({
  kind: z.literal("task_armed"),
  note: z.string(),
  target: z.record(z.string(), z.unknown()),
  taskId: z.string(),
  taskKind: z.enum(["timer", "workflow_run"]),
});
export type MothershipStreamV1TaskArmedPayload = z.infer<typeof TaskArmedPayloadSchema>;

const TaskDeliveredPayloadSchema = z.object({
  kind: z.literal("task_delivered"),
  status: z.enum(["completed", "failed", "stopped", "expired"]),
  summary: z.string(),
  taskId: z.string(),
});
export type MothershipStreamV1TaskDeliveredPayload = z.infer<typeof TaskDeliveredPayloadSchema>;

/**
 * `message` is required. `error` is a Sim-emitted copy of it (Sim's terminal-failure frame sets
 * both) and `data` Sim-emitted detail (e.g. the replay-gap bounds); the worker sends neither.
 * Sim's own emitters are typed by this schema, so none sends `error` without `message` (D122).
 */
const ErrorPayloadSchema = z.object({
  code: z.string().exactOptional(),
  data: z.unknown().exactOptional(),
  displayMessage: z.string().exactOptional(),
  error: z.string().exactOptional(),
  message: z.string(),
  provider: z.string().exactOptional(),
});
export type MothershipStreamV1ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

const CostDataSchema = z.object({
  input: z.number().exactOptional(),
  output: z.number().exactOptional(),
  total: z.number().exactOptional(),
});
export type MothershipStreamV1CostData = z.infer<typeof CostDataSchema>;

const UsageDataSchema = z.object({
  cache_creation_input_tokens: z.number().exactOptional(),
  cache_read_input_tokens: z.number().exactOptional(),
  input_tokens: z.number().exactOptional(),
  model: z.string().exactOptional(),
  output_tokens: z.number().exactOptional(),
  total_tokens: z.number().exactOptional(),
});
export type MothershipStreamV1UsageData = z.infer<typeof UsageDataSchema>;

const CompletePayloadSchema = z.object({
  ...StreamTextCompletionSchema.shape,
  ...StreamActivityCheckpointSchema.shape,
  cost: CostDataSchema.exactOptional(),
  reason: z.string().exactOptional(),
  response: z.unknown().exactOptional(),
  status: z.enum(MothershipStreamV1CompletionStatus),
  usage: UsageDataSchema.exactOptional(),
});
export type MothershipStreamV1CompletePayload = z.infer<typeof CompletePayloadSchema>;

const SessionPayloadSchema = z.discriminatedUnion("kind", [
  SessionStartPayloadSchema,
  SessionChatPayloadSchema,
  SessionTitlePayloadSchema,
]);
const ToolPayloadSchema = z.discriminatedUnion("phase", [
  ToolCallDescriptorSchema,
  ToolArgsDeltaPayloadSchema,
  ToolResultPayloadSchema,
]);
const RunPayloadSchema = z.discriminatedUnion("kind", [
  CheckpointPausePayloadSchema,
  CompactionStartPayloadSchema,
  CompactionDonePayloadSchema,
  SteeringAppliedPayloadSchema,
  TaskArmedPayloadSchema,
  TaskDeliveredPayloadSchema,
]);

/**
 * Every live frame on the wire. On success a reader keeps its own value, not the parsed copy:
 * the copy has unknown keys stripped. Its inferred type is not distributed over the payloads;
 * readers type a frame as {@link MothershipStreamV1EventEnvelope}.
 */
export const MothershipStreamV1EventEnvelopeSchema = z.discriminatedUnion("type", [
  EnvelopeShellSchema.extend({ type: z.literal("session"), payload: SessionPayloadSchema }),
  EnvelopeShellSchema.extend({ type: z.literal("text"), payload: TextPayloadSchema }),
  EnvelopeShellSchema.extend({ type: z.literal("tool"), payload: ToolPayloadSchema }),
  EnvelopeShellSchema.extend({ type: z.literal("span"), payload: SubagentSpanPayloadSchema }),
  EnvelopeShellSchema.extend({ type: z.literal("resource"), payload: ResourcePayload }),
  EnvelopeShellSchema.extend({ type: z.literal("run"), payload: RunPayloadSchema }),
  EnvelopeShellSchema.extend({ type: z.literal("error"), payload: ErrorPayloadSchema }),
  EnvelopeShellSchema.extend({ type: z.literal("complete"), payload: CompletePayloadSchema }),
]);

/** One envelope member per payload variant, so `Extract<…, { payload: { phase: "call" } }>` works. */
type EnvelopesOf<TType extends string, TPayload> = TPayload extends unknown
  ? MothershipStreamV1Envelope<TType, TPayload>
  : never;

/** Every frame on the wire, one member per payload shape. */
export type MothershipStreamV1EventEnvelope =
  | EnvelopesOf<"session", z.infer<typeof SessionPayloadSchema>>
  | EnvelopesOf<"text", MothershipStreamV1TextPayload>
  | EnvelopesOf<"tool", z.infer<typeof ToolPayloadSchema>>
  | EnvelopesOf<"span", MothershipStreamV1SubagentSpanPayload>
  | MothershipStreamV1Envelope<"resource", ResourcePayload>
  | EnvelopesOf<"run", z.infer<typeof RunPayloadSchema>>
  | EnvelopesOf<"error", MothershipStreamV1ErrorPayload>
  | EnvelopesOf<"complete", MothershipStreamV1CompletePayload>;

/** The payload a frame of `type` carries. */
type PayloadOf<TType extends MothershipStreamV1EventType> = Extract<
  MothershipStreamV1EventEnvelope,
  { type: TType }
>["payload"];

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

export type MothershipStreamV1ToolPhase = PayloadOf<"tool">["phase"];

export const MothershipStreamV1ToolPhase = {
  call: "call",
  args_delta: "args_delta",
  result: "result",
} as const satisfies { [K in MothershipStreamV1ToolPhase]: K };

export type MothershipStreamV1SpanPayloadKind = PayloadOf<"span">["kind"];

export const MothershipStreamV1SpanPayloadKind = {
  subagent: "subagent",
} as const satisfies { [K in MothershipStreamV1SpanPayloadKind]: K };

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

// The replay-end control frame (D117, D121). POST /api/streams/replay ends a leg short of the run's
// terminal with this one `run` frame. It is deliberately NOT a member of
// `MothershipStreamV1EventEnvelope` and its kind is NOT in `MothershipStreamV1RunKind`: Sim's live
// reader accepts exactly that const's kinds, so a replay_end arriving on a live stream is rejected,
// and only Sim's replay reader, which checks for this frame before its v1 validation, accepts it.

export const MothershipStreamV1ReplayEndKind = "replay_end";

/**
 * Why a replay leg ended before the run's terminal. `parked`: the run waits on tool results the
 * owner's leg handed Sim. `cap`: the connection reached its length cap; replay again. `stalled`: no
 * instance drives the run (stale heartbeat, not parked); replay again later, once a takeover can
 * have resumed it.
 */
export const MothershipStreamV1ReplayEndReason = {
  parked: "parked",
  cap: "cap",
  stalled: "stalled",
} as const;
export type MothershipStreamV1ReplayEndReason =
  (typeof MothershipStreamV1ReplayEndReason)[keyof typeof MothershipStreamV1ReplayEndReason];

/**
 * `textLength` is the main text this leg's log reached — diagnostic only. A later replay sends
 * Sim's OWN received length as `receivedTextChars`, never this value: the log trails live text, and
 * resending from the durable end is what exposes divergence. Replayed tool activity is presentation
 * only (`replay: true`) and never authorizes execution.
 */
export const MothershipStreamV1ReplayEndPayloadSchema = z.object({
  kind: z.literal(MothershipStreamV1ReplayEndKind),
  reason: z.enum(MothershipStreamV1ReplayEndReason),
  textLength: z.number().int().nonnegative(),
});
export type MothershipStreamV1ReplayEndPayload = z.infer<typeof MothershipStreamV1ReplayEndPayloadSchema>;

/** The replay-end frame, validated on its own: it is outside the live envelope union. */
export const MothershipStreamV1ReplayEndEnvelopeSchema = EnvelopeShellSchema.extend({
  type: z.literal(MothershipStreamV1EventType.run),
  payload: MothershipStreamV1ReplayEndPayloadSchema,
});

export type MothershipStreamV1ReplayEndEnvelope = MothershipStreamV1Envelope<
  typeof MothershipStreamV1EventType.run,
  MothershipStreamV1ReplayEndPayload
>;
