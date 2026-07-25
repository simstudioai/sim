/**
 * Public agent stream protocol: header negotiation and the wire frame
 * vocabulary for the public chat / simple SSE surface.
 *
 * Two orthogonal things are decided here:
 *
 * 1. Answer-text cadence — {@link AGENT_STREAM_PROTOCOL_HEADER} means the client
 *    understands v1 framing, so answer text may stream live and be retracted
 *    with `chunk_reset`. Without it the client keeps settled final-turn text.
 *    This is a capability question: a client that cannot honor `chunk_reset`
 *    would render duplicated text, so it must not be opted in on its behalf.
 * 2. Event exposure — thinking frames need `includeThinking`, tool frames need
 *    `includeToolCalls`, and both additionally need the negotiated protocol
 *    above. Declaring the version is what lets these frames evolve without
 *    breaking clients that never opted in.
 *
 * The header alone exposes nothing, so a chat with both policies off still
 * streams token by token. Where the *caller* requests frames — the workflow
 * API — asking without negotiating is rejected rather than silently downgraded.
 *
 * Canvas draft runs (execution-events) forward the same sink as live-only
 * `stream:thinking` / `stream:tool` events without the policy gates; the
 * executor still disables the sink when block-output PII redaction is on.
 *
 * See docs: workflows/deployment/agent-events.
 */

import { isToolCallEndStatus, type ToolCallEndStatus } from '@/providers/stream-events'

/** Lookup key. Lowercase because HTTP/2 lowercases on the wire; `Headers.get` is case-insensitive either way. */
export const AGENT_STREAM_PROTOCOL_HEADER = 'x-sim-stream-protocol' as const

/** Canonical casing, for docs and generated code samples. */
export const AGENT_STREAM_PROTOCOL_HEADER_LABEL = 'X-Sim-Stream-Protocol' as const

export const AGENT_STREAM_PROTOCOL_V1 = 'agent-events-v1' as const

export type AgentStreamProtocol = typeof AGENT_STREAM_PROTOCOL_V1

/**
 * Answer text. The only frame legacy clients append to the answer.
 *
 * Legacy clients (no protocol header) receive only settled final-turn text.
 * Protocol-negotiated clients receive answer text live as it streams —
 * including text from a turn that may later resolve to tool calls — reconciled
 * by {@link ChatStreamChunkResetFrame} when a turn turns out to be intermediate.
 */
export interface ChatStreamChunkFrame {
  blockId: string
  chunk: string
}

/**
 * Negotiated agent-events streams only: the live-streamed answer text for
 * `blockId` belonged to an intermediate turn (tool calls follow). Clients
 * discard the block's accumulated answer text; the final turn re-streams after
 * tools settle.
 */
export interface ChatStreamChunkResetFrame {
  blockId: string
  event: 'chunk_reset'
}

/** Thinking / reasoning-summary delta. Thinking-policy gated; never reuses `chunk`. */
export interface ChatStreamThinkingFrame {
  blockId: string
  event: 'thinking'
  data: string
}

/** Tool lifecycle (name + status only — never args or results). Tool-policy gated. */
export interface ChatStreamToolFrame {
  blockId: string
  event: 'tool'
  phase: 'start' | 'end'
  id: string
  name: string
  status?: ToolCallEndStatus
}

/** Terminal success envelope, followed by `[DONE]`. */
export interface ChatStreamFinalFrame {
  event: 'final'
  data: Record<string, unknown>
}

/** Terminal failure, followed by `[DONE]`. Never followed by `final`. */
export interface ChatStreamErrorFrame {
  blockId?: string
  event: 'error'
  error: string
}

/** Non-terminal mid-block read issue; the stream keeps going. */
export interface ChatStreamStreamErrorFrame {
  blockId?: string
  event: 'stream_error'
  error: string
}

/**
 * Every JSON frame the public chat / simple SSE stream can carry (the stream
 * additionally ends with a literal `[DONE]` marker). The server emitters and
 * the chat client both consume this union so the two cannot drift.
 */
export type ChatStreamFrame =
  | ChatStreamChunkFrame
  | ChatStreamChunkResetFrame
  | ChatStreamThinkingFrame
  | ChatStreamToolFrame
  | ChatStreamFinalFrame
  | ChatStreamErrorFrame
  | ChatStreamStreamErrorFrame

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

/**
 * Answer text frame: `{ blockId, chunk }` with no `event` discriminator.
 * Positively defined so thinking/tool/terminal frames can never be appended
 * into the answer by a client that checks this first.
 */
export function isChatChunkFrame(value: unknown): value is ChatStreamChunkFrame {
  if (!isRecord(value)) return false
  return (
    typeof value.blockId === 'string' &&
    typeof value.chunk === 'string' &&
    value.chunk.length > 0 &&
    value.event === undefined
  )
}

export function isChatChunkResetFrame(value: unknown): value is ChatStreamChunkResetFrame {
  if (!isRecord(value)) return false
  return value.event === 'chunk_reset' && typeof value.blockId === 'string'
}

export function isChatThinkingFrame(value: unknown): value is ChatStreamThinkingFrame {
  if (!isRecord(value)) return false
  return (
    value.event === 'thinking' &&
    typeof value.blockId === 'string' &&
    typeof value.data === 'string'
  )
}

export function isChatToolFrame(value: unknown): value is ChatStreamToolFrame {
  if (!isRecord(value)) return false
  return (
    value.event === 'tool' &&
    typeof value.blockId === 'string' &&
    (value.phase === 'start' || value.phase === 'end') &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    // An unrecognized status is a protocol violation, not a success. Rejecting
    // the frame leaves the chip running for the terminal settle (which knows
    // the run's real outcome) instead of rendering it green on a guess.
    (value.status === undefined || isToolCallEndStatus(value.status))
  )
}

export function isChatFinalFrame(value: unknown): value is ChatStreamFinalFrame {
  if (!isRecord(value)) return false
  return value.event === 'final' && isRecord(value.data)
}

export function isChatErrorFrame(value: unknown): value is ChatStreamErrorFrame {
  if (!isRecord(value)) return false
  return value.event === 'error'
}

export function isChatStreamErrorFrame(value: unknown): value is ChatStreamStreamErrorFrame {
  if (!isRecord(value)) return false
  return value.event === 'stream_error'
}

/**
 * Whether the client declared it understands agent-events-v1 framing.
 *
 * This is a statement about the *client*, not about what a deployment may
 * expose: sending the header means the client appends `chunk` and honors
 * `chunk_reset`, so answer text can stream live and be retracted. Thinking and
 * tool exposure are separate deployment policies on top of this.
 */
export function clientAcceptsAgentStreamProtocol(
  requestHeaders: Headers | { get(name: string): string | null }
): boolean {
  const raw = requestHeaders.get(AGENT_STREAM_PROTOCOL_HEADER)
  if (!raw) {
    return false
  }

  // Allow comma-separated values / surrounding whitespace from proxies.
  const tokens = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)

  return tokens.includes(AGENT_STREAM_PROTOCOL_V1)
}

/** True when either agent-event policy is on, before protocol negotiation. */
export function hasAgentStreamPolicy(options: {
  includeThinking: boolean | null | undefined
  includeToolCalls: boolean | null | undefined
}): boolean {
  return options.includeThinking === true || options.includeToolCalls === true
}

/**
 * Returns true when a negotiated client may receive thinking or tool frames —
 * at least one policy is on and the client declared the protocol version.
 *
 * Drives the run-level `agentEvents` flag, which asks providers for reasoning
 * summaries. Answer-text cadence does *not* depend on this: a negotiated client
 * streams live text even with both policies off. Frame emitters still apply
 * each independent policy before exposing its corresponding frames.
 *
 * Surfaces that let the *caller* request frames should reject an un-negotiated
 * request outright rather than degrade to this returning false — see
 * {@link hasAgentStreamPolicy}. A silent downgrade is the failure mode this
 * protocol is meant to avoid.
 */
export function shouldEmitAgentStreamEvents(options: {
  includeThinking: boolean | null | undefined
  includeToolCalls: boolean | null | undefined
  requestHeaders: Headers | { get(name: string): string | null }
}): boolean {
  if (!hasAgentStreamPolicy(options)) {
    return false
  }

  return clientAcceptsAgentStreamProtocol(options.requestHeaders)
}
