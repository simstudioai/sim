/**
 * Public agent stream protocol: header negotiation and the wire frame
 * vocabulary for the public chat / simple SSE surface.
 *
 * Exposure rule (locked) for public chat / simple SSE:
 *   emit thinking/tool SSE frames iff
 *     deployment.includeThinking === true
 *     AND request opts into agent-events-v1 via {@link AGENT_STREAM_PROTOCOL_HEADER}
 *
 * Canvas draft runs (execution-events) forward the same sink as live-only
 * `stream:thinking` / `stream:tool` events without the includeThinking gate;
 * the executor still disables the sink when block-output PII redaction is on.
 *
 * Legacy clients omitting the header stay text-only even when the deployment
 * has thinking enabled. Deployed chat UI always sends the header when loading
 * its own deployment.
 *
 * See docs: workflows/deployment/agent-events.
 */

import type { ToolCallEndStatus } from '@/providers/stream-events'

export const AGENT_STREAM_PROTOCOL_HEADER = 'x-sim-stream-protocol' as const

export const AGENT_STREAM_PROTOCOL_V1 = 'agent-events-v1' as const

export type AgentStreamProtocol = typeof AGENT_STREAM_PROTOCOL_V1

/** Final-turn answer text. The only frame legacy clients append to the answer. */
export interface ChatStreamChunkFrame {
  blockId: string
  chunk: string
}

/** Thinking / reasoning-summary delta. Dual-gated; never reuses `chunk`. */
export interface ChatStreamThinkingFrame {
  blockId: string
  event: 'thinking'
  data: string
}

/** Tool lifecycle (name + status only — never args or results). Dual-gated. */
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
    value.name.length > 0
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
 * Returns true when both the deployment policy and the request protocol opt-in
 * are present. Simple SSE checks this before emitting thinking/tool frames.
 */
export function shouldEmitAgentStreamEvents(options: {
  includeThinking: boolean | null | undefined
  requestHeaders: Headers | { get(name: string): string | null }
}): boolean {
  if (options.includeThinking !== true) {
    return false
  }

  const raw = options.requestHeaders.get(AGENT_STREAM_PROTOCOL_HEADER)
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
