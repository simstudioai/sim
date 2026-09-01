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

export const PROTOCOL_VERSION = 1;

/** POST /api/mothership — the chat request sim sends. */
export interface ChatRequest {
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
}

export interface ChatContextItem {
  type: string;
  content: string;
  tag?: string | undefined;
  path?: string | undefined;
}

/** POST /api/tools/resume — deferred tool results. */
export interface ResumeRequest {
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

/** POST /api/streams/steer. Acceptance means "queued"; application is acknowledged by a
 * `run`/`steering_applied` frame carrying the steeringId — a caller that never sees the
 * ack re-sends the content as an ordinary message (loss-free without liveness proof). */
export interface SteerRequest {
  messageId: string;
  steeringId?: string | undefined;
  content: string;
}

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
 * POST /api/mothership/execute — the one-shot headless surface (the agent block in a
 * workflow, inbox automations). The caller supplies the full conversation (the block's own
 * system prompt included) and the tool schemas; the worker runs one bounded loop and
 * streams the same mothership-stream-v1 frames. No skills, no CLI — the block's tool
 * surface is exactly what the caller passes.
 */
export interface ExecuteRequest {
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
