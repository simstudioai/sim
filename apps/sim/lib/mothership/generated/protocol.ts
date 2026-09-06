// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/protocol.ts
// Regenerate with `bun run contracts:sync` in the worker.

/**
 * The sim⇄worker wire protocol surface — THE shared source of truth (P3, S31).
 *
 * This file is COPIED VERBATIM into the sim repo by `bun run contracts:sync`
 * (`apps/sim/lib/mothership/generated/protocol.ts`); `check:contract-sync` fails the build
 * when the copies drift (S39). Sim imports these types, so schema skew is a compile error
 * on either side; the worker's zod validators are type-asserted against these shapes in
 * http/server.ts, so the runtime contract cannot drift from this file either.
 *
 * PROTOCOL_VERSION gates self-hosted version skew (S43): bump it on ANY breaking change to
 * the payloads or frames below. The worker answers a mismatched client with an honest 426
 * instead of undefined behavior.
 */

import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/** Activity acknowledged through a completed leg, scoped to one emitter's lifetime. */
export interface StreamActivityReceipt {
  emitterId: string;
  sequence: number;
}

/** Applied response state: text uses UTF-16 units; activity positions belong to their emitter. */
export interface StreamResponseReceipt {
  receivedTextChars?: number | undefined;
  receivedActivity?: StreamActivityReceipt | undefined;
}

const ActivityReceiptSchema = z.object({
  emitterId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative().safe(),
}) satisfies z.ZodType<StreamActivityReceipt>;

/** HTTP and fleet delivery accept the same bounded response receipt. */
export const ResponseReceiptSchema = z.object({
  receivedTextChars: z.number().int().nonnegative().safe().optional(),
  receivedActivity: ActivityReceiptSchema.optional(),
}) satisfies z.ZodType<StreamResponseReceipt>;

const InventoryNamed = z.object({ id: z.string(), name: z.string() });
const WorkspaceInventorySchema = z.object({
  workspaceName: z.string().optional(),
  workflows: z.array(
    z.object({ id: z.string(), name: z.string(), folder: z.string().optional(), deployed: z.boolean() }),
  ),
  tables: z.array(InventoryNamed),
  knowledgeBases: z.array(InventoryNamed),
  files: z.array(z.object({ path: z.string(), size: z.number().optional() })),
  skills: z.array(z.object({ name: z.string() })),
  customTools: z.array(z.object({ id: z.string(), title: z.string() })),
  mcpServers: z.array(InventoryNamed),
  credentials: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string().optional(),
      type: z.string().optional(),
    }),
  ),
  secrets: z.array(z.string()),
  truncated: z.array(z.string()),
});

export const ChatPayloadSchema = z.strictObject({
  message: z.string().min(1),
  ...ResponseReceiptSchema.shape,
  userId: z.string().min(1),
  /** Bump-gated (S43): when present and mismatched the worker answers 426, never undefined behavior. */
  protocolVersion: z.number().int().optional(),
  messageId: z.uuid().optional(),
  chatId: z.uuid().optional(),
  /** Required (see contracts ChatRequest): absence used to fabricate a random identity. */
  workspaceId: z.uuid(),
  /** Workflow-scoped chats (the workflow-page copilot): the agent anchors to this workflow. */
  workflowId: z.string().optional(),
  integrationTools: z.array(z.unknown()).default([]),
  /** User-configured MCP tool schemas — same shape as integrationTools; served by the gateway. */
  mothershipTools: z.array(z.unknown()).default([]),
  /** Accepted for wire compatibility with current sim builds; unused — the CLI now
   * executes on the sim side under sim's own authentication, so no credential crosses. */
  delegationToken: z.string().optional(),
  /** Enterprise BYOK: the customer's own Anthropic key. Pins the native backend for the
   * run; in-memory only — never persisted, logged, or on spans (S27). */
  byokApiKey: z.string().optional(),
  /** User attachments / @-mentions the UI packed with the message. */
  context: z
    .array(
      z.object({
        type: z.string(),
        content: z.string(),
        tag: z.string().optional(),
        path: z.string().optional(),
      }),
    )
    .default([]),
  userTimezone: z.string().optional(),
  /** Explicit client-executor declaration (see contracts ChatRequest.clientCapabilities);
   * the worker accepts and ignores it — dispatch semantics live on the sim side. */
  clientCapabilities: z.array(z.string()).default([]),
  /** "task": sim opened this turn for a background-task notification, not for a typed
   * message (21-background-tasks.md); recorded on the turn's user_message event. */
  origin: z.enum(["task"]).optional(),
  /** Per-turn effort dial (user-selected in the composer); absent = deployment default. */
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  /** Workspace orientation (contracts ChatRequest.inventory): names and ids per world. */
  inventory: WorkspaceInventorySchema.optional(),
});

/** A pause or terminal acknowledges all preceding activity only after the receiver handles it. */
export interface StreamActivityCheckpoint {
  activityReceipt?: StreamActivityReceipt | undefined;
}

/** Main-assistant text position within this run, measured in UTF-16 code units. */
export interface StreamTextPosition {
  textOffset?: number | undefined;
}

/** Successful completion states the complete main-answer size, including any replayed prefix. */
export interface StreamTextCompletion {
  textLength?: number | undefined;
}

/** Replayed tool activity is presentation only; it never authorizes execution or approval. */
export interface StreamToolReplay {
  replay?: true | undefined;
}

/** POST /api/mothership — the chat request sim sends. */
export interface ChatRequest extends StreamResponseReceipt {
  message: string;
  userId: string;
  /** Bump-gated (S43): senders include it; the worker 426s on mismatch. */
  protocolVersion?: number | undefined;
  messageId?: string | undefined;
  chatId?: string | undefined;
  /** Required: memories, analytics, and the chat row all key on it — sim always resolves
   * it (workspace-scoped directly; workflow-scoped from the workflow). A missing value
   * used to FABRICATE a random workspace identity per request. */
  workspaceId: string;
  /** Workflow-scoped chats (the workflow-page copilot): the agent anchors to this workflow. */
  workflowId?: string | undefined;
  /** Connected-service operation schemas served by the integration gateway. */
  integrationTools?: unknown[] | undefined;
  /** User-configured MCP tool schemas — same shape as integrationTools. */
  mothershipTools?: unknown[] | undefined;
  /** Deprecated: unused since the CLI moved to sim-side in-process execution (no
   * credential crosses the wire); accepted so current senders keep validating. */
  delegationToken?: string | undefined;
  /** Enterprise BYOK: customer's own key; per-run instance, zero retention (S27). */
  byokApiKey?: string | undefined;
  /** User attachments / @-mentions packed with the message. */
  context?: ChatContextItem[] | undefined;
  userTimezone?: string | undefined;
  /**
   * What the CALLER can execute client-side. PRESENT = an explicit declaration — an
   * empty array means "I pick up nothing", so sim-side dispatch must skip client-pickup
   * grace windows and run tools server-side immediately. ABSENT = older/unknown caller —
   * dispatch keeps its conservative grace (deploy-skew safe: a stale tab that predates
   * this field still gets waited on). Known capability: "workflow-tool-pickup".
   */
  clientCapabilities?: string[] | undefined;
  /**
   * What exists in the workspace, by name and id, so the agent orients without a round
   * of listings per world (an orientation turn on dev spent nine tool rounds and ~20K
   * tokens learning this). Names and ids only — never a tree, never contents — and each
   * world capped; a capped world is named in `truncated` so the agent lists it itself.
   * Rendered as a request-local trailing message, never into the transcript.
   */
  inventory?: WorkspaceInventory | undefined;
}

export interface WorkspaceInventory {
  workspaceName?: string | undefined;
  workflows: { id: string; name: string; folder?: string | undefined; deployed: boolean }[];
  tables: { id: string; name: string }[];
  knowledgeBases: { id: string; name: string }[];
  /** `files/...` paths as the CLI prints them. */
  files: { path: string; size?: number | undefined }[];
  skills: { name: string }[];
  customTools: { id: string; title: string }[];
  mcpServers: { id: string; name: string }[];
  credentials: { id: string; name: string; provider?: string | undefined; type?: string | undefined }[];
  /** Names only, by construction. */
  secrets: string[];
  /** Worlds with more entries than listed. */
  truncated: string[];
}

export interface ChatContextItem {
  type: string;
  content: string;
  tag?: string | undefined;
  path?: string | undefined;
}

/** POST /api/tools/resume — deferred tool results. */
export interface ResumeRequest extends StreamResponseReceipt {
  streamId: string;
  results: ResumeResult[];
  /**
   * Enterprise BYOK, re-resolved by sim per call (S27: context-only, zero retention).
   * A LIVE run keeps its key inside the loop closure and ignores this; a DEAD run's
   * continuation leg has no closure, so without it that leg would silently fall back
   * to the hosted key mid-chat.
   */
  byokApiKey?: string | undefined;
}

export interface ResumeResult {
  callId: string;
  name?: string | undefined;
  data?: unknown | undefined;
  success?: boolean | undefined;
}

/** POST /api/streams/explicit-abort */
export interface AbortRequest {
  messageId: string;
}

/** Accepted Stop intent is distinct from an observed terminal worker run. */
export interface AbortResponse {
  stopped: boolean;
  settled: boolean;
}

/** POST /api/streams/steer. Acceptance means "queued"; application is acknowledged by a
 * `run`/`steering_applied` frame carrying the steeringId — a caller that never sees the
 * ack re-sends the content as an ordinary message (loss-free without liveness proof). */
export interface SteerRequest {
  messageId: string;
  steeringId?: string | undefined;
  content: string;
}

/** POST /api/chats/fork — copy a selected conversation snapshot, never live execution. */
export const ForkChatRequest = z.strictObject({
  sourceChatId: z.uuid(),
  newChatId: z.uuid(),
  workspaceId: z.uuid(),
  userId: z.string().min(1),
  upToMessageId: z.string().min(1),
  includeResponse: z.boolean(),
  fileIds: z.record(z.string().min(1), z.string().min(1)),
  fileKeys: z.record(z.string().min(1), z.string().min(1)),
});
export type ForkChatRequest = z.infer<typeof ForkChatRequest>;

export const ForkChatResponse = z.strictObject({
  chatId: z.uuid(),
  sourceThroughSeq: z.number().int().positive(),
});
export type ForkChatResponse = z.infer<typeof ForkChatResponse>;

/** POST /api/generate-chat-title */
export interface TitleRequest {
  message: string;
  /** Enterprise BYOK: the title call reads user content, so it pins the same key (S27). */
  byokApiKey?: string | undefined;
  /** Metering identity (Go metered title spend into request analytics): optional so
   * older sim builds keep validating; absent values degrade to synthetic ids. */
  chatId?: string | undefined;
  workspaceId?: string | undefined;
  userId?: string | undefined;
}

/** The 409 body for a duplicate send while a sibling instance streams (S32). */
export interface ActiveStreamConflict {
  error: "active_stream";
  streamId: string;
  status: string;
}

/** The 426 body for protocol version skew (S43). */
export interface ProtocolMismatch {
  error: "protocol_version_mismatch";
  expected: number;
  got: number;
  message: string;
}

/**
 * POST /api/mothership/execute — the one-shot headless surface used by Sim Chat blocks.
 * The caller supplies the full conversation (its system prompt included) and the tool
 * schemas; the worker runs one bounded loop and
 * streams the same mothership-stream-v1 frames. No skills or CLI; local search and the
 * execution gateway expose only the caller-provided integration/MCP operations.
 */
export interface ExecuteRequest extends StreamResponseReceipt {
  messages: ExecuteMessage[];
  /** JSON schema for structured output; enforced by instruction + caller-side validation. */
  responseFormat?: unknown | undefined;
  userId: string;
  protocolVersion?: number | undefined;
  workspaceId?: string | undefined;
  chatId?: string | undefined;
  messageId?: string | undefined;
  integrationTools?: unknown[] | undefined;
  mothershipTools?: unknown[] | undefined;
  delegationToken?: string | undefined;
  /** Enterprise BYOK: one-shot executions pin the customer key like chat turns (S27). */
  byokApiKey?: string | undefined;
}

export interface ExecuteMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The response half of the wire: every SSE `data:` line is one StreamEnvelope (the
 * mothership-stream-v1 shape), terminated by a literal `data: [DONE]` line per leg. The
 * worker's emitter is compile-locked to this; sim's parser adopts it at the client rework.
 */
export interface StreamEnvelope {
  v: 1;
  type: "session" | "text" | "tool" | "span" | "run" | "resource" | "plan" | "error" | "complete";
  seq: number;
  /** ISO timestamp. */
  ts: string;
  stream: { streamId: string; chatId?: string | undefined; cursor?: string | undefined };
  trace?: { requestId?: string | undefined } | undefined;
  /** Subagent-lane attribution (mothership-stream-v1 scope): frames carrying it render
   * inside the named root-level lane instead of the main transcript. */
  scope?: StreamScope | undefined;
  payload: Record<string, unknown>;
}

/** One step of the agent's visible plan (the update_plan tool's whole-list payload). */
export interface PlanItem {
  step: string;
  status: "pending" | "active" | "done";
}

/** One subagent lane: keyed by the delegating tool call; agentId/spanId identify the lane. */
export interface StreamScope {
  lane: "subagent";
  agentId?: string | undefined;
  parentToolCallId?: string | undefined;
  spanId?: string | undefined;
  parentSpanId?: string | undefined;
}
