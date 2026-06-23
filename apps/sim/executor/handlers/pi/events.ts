/**
 * Normalization layer for the Pi agent event stream. Both backends produce the
 * same logical events — the local backend via the SDK `session.subscribe`
 * callback, the cloud backend via `pi --mode json` stdout lines — so this module
 * maps either source into a single {@link PiEvent} union and accumulates the
 * run totals (final text, token usage, tool calls) the handler reports.
 */

/** A single normalized event emitted during a Pi run. */
export type PiEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end'; toolName: string; isError: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'final'; text?: string }
  | { type: 'error'; message: string }
  | { type: 'other' }

/** A tool invocation observed during the run. */
export interface PiToolCallRecord {
  name: string
  isError?: boolean
}

/** Running totals accumulated across a Pi run. */
export interface PiRunTotals {
  finalText: string
  inputTokens: number
  outputTokens: number
  toolCalls: PiToolCallRecord[]
  errorMessage?: string
}

/** Creates an empty totals accumulator. */
export function createPiTotals(): PiRunTotals {
  return { finalText: '', inputTokens: 0, outputTokens: 0, toolCalls: [] }
}

/**
 * Folds a normalized event into the totals. Text deltas accumulate into
 * `finalText`; usage events sum (Pi reports per-turn usage on `turn_end`).
 */
export function applyPiEvent(totals: PiRunTotals, event: PiEvent): void {
  switch (event.type) {
    case 'text':
      totals.finalText += event.text
      break
    case 'final':
      if (event.text && totals.finalText.length === 0) {
        totals.finalText = event.text
      }
      break
    case 'usage':
      totals.inputTokens += event.inputTokens
      totals.outputTokens += event.outputTokens
      break
    case 'tool_end':
      totals.toolCalls.push({ name: event.toolName, isError: event.isError })
      break
    case 'error':
      totals.errorMessage = event.message
      break
    default:
      break
  }
}

/** Returns the text to enqueue onto the content stream for an event, if any. */
export function streamTextForEvent(event: PiEvent): string | null {
  return event.type === 'text' ? event.text : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Extracts token usage from an event, tolerating the field names Pi and common
 * provider payloads use (`input`/`output`, `inputTokens`/`outputTokens`,
 * `prompt_tokens`/`completion_tokens`), checked on the event and on a nested
 * `message`/`usage` object.
 */
function extractUsage(
  ev: Record<string, unknown>
): { inputTokens: number; outputTokens: number } | null {
  const candidates: Array<Record<string, unknown>> = []
  const direct = asRecord(ev.usage)
  if (direct) candidates.push(direct)
  const message = asRecord(ev.message)
  if (message) {
    const messageUsage = asRecord(message.usage)
    if (messageUsage) candidates.push(messageUsage)
  }

  for (const usage of candidates) {
    const input =
      asNumber(usage.input) || asNumber(usage.inputTokens) || asNumber(usage.prompt_tokens)
    const output =
      asNumber(usage.output) || asNumber(usage.outputTokens) || asNumber(usage.completion_tokens)
    if (input > 0 || output > 0) {
      return { inputTokens: input, outputTokens: output }
    }
  }

  return null
}

/** Normalizes a raw Pi/SDK event object into a {@link PiEvent}. */
export function normalizePiEvent(raw: unknown): PiEvent | null {
  const ev = asRecord(raw)
  if (!ev) return null

  switch (asString(ev.type)) {
    case 'message_update': {
      const assistantEvent = asRecord(ev.assistantMessageEvent)
      const deltaType = assistantEvent ? asString(assistantEvent.type) : ''
      const delta = assistantEvent ? asString(assistantEvent.delta) : ''
      if (deltaType === 'text_delta') return { type: 'text', text: delta }
      if (deltaType === 'thinking_delta') return { type: 'thinking', text: delta }
      return { type: 'other' }
    }
    case 'tool_execution_start':
      return { type: 'tool_start', toolName: asString(ev.toolName) }
    case 'tool_execution_end':
      return { type: 'tool_end', toolName: asString(ev.toolName), isError: ev.isError === true }
    case 'turn_end': {
      const usage = extractUsage(ev)
      return usage ? { type: 'usage', ...usage } : { type: 'other' }
    }
    case 'agent_end':
      return { type: 'final' }
    case 'error':
      return {
        type: 'error',
        message: asString(ev.error) || asString(ev.message) || 'Pi run failed',
      }
    default:
      return { type: 'other' }
  }
}

/** Parses one `pi --mode json` stdout line into a {@link PiEvent}. */
export function parseJsonLine(line: string): PiEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return normalizePiEvent(JSON.parse(trimmed))
  } catch {
    return null
  }
}
