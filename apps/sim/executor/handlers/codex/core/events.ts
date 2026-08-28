/**
 * Normalizes the JSONL protocol emitted by `codex exec --json`.
 *
 * The wire shape is pinned to `@openai/codex@0.146.0` and the corresponding
 * `codex-rs/exec/src/exec_events.rs` contract. Keep the fixtures and parser in
 * lockstep when the sandbox image upgrades Codex.
 */

import { toRecordOrNull } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'

export const MAX_CODEX_TOOL_OUTPUT_CHARS = 4_000
const MAX_CODEX_TOOL_SUMMARY_CHARS = 500

/** A normalized event emitted during one Codex turn. */
export type CodexEvent =
  | { type: 'thread_started'; threadId: string }
  | { type: 'turn_started' }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; toolName: string; summary?: string }
  | {
      type: 'tool_end'
      id: string
      toolName: string
      isError: boolean
      summary?: string
      output?: string
    }
  | {
      type: 'usage'
      inputTokens: number
      cachedInputTokens: number
      cacheWriteInputTokens: number
      outputTokens: number
      reasoningOutputTokens: number
    }
  | { type: 'final' }
  | { type: 'error'; message: string }
  | { type: 'other' }

/** Bounded summary of a completed Codex tool item. */
export interface CodexToolCallRecord {
  id: string
  name: string
  isError: boolean
  summary?: string
  output?: string
}

/** Running totals and terminal state for one `codex exec` process. */
export interface CodexRunTotals {
  finalText: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  toolCalls: CodexToolCallRecord[]
  threadId?: string
  turnCompleted: boolean
  errorMessage?: string
}

/** Creates an empty Codex totals accumulator. */
export function createCodexTotals(): CodexRunTotals {
  return {
    finalText: '',
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    toolCalls: [],
    turnCompleted: false,
  }
}

/** Folds one normalized event into the run totals. */
export function applyCodexEvent(totals: CodexRunTotals, event: CodexEvent): void {
  switch (event.type) {
    case 'thread_started':
      totals.threadId = event.threadId
      break
    case 'text':
      /** Exec emits complete messages; the last is final and earlier ones are progress notes. */
      totals.finalText = event.text
      break
    case 'tool_end':
      totals.toolCalls.push({
        id: event.id,
        name: event.toolName,
        isError: event.isError,
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.output ? { output: event.output } : {}),
      })
      break
    case 'usage':
      totals.inputTokens += event.inputTokens
      totals.cachedInputTokens += event.cachedInputTokens
      totals.cacheWriteInputTokens += event.cacheWriteInputTokens
      totals.outputTokens += event.outputTokens
      totals.reasoningOutputTokens += event.reasoningOutputTokens
      break
    case 'final':
      totals.turnCompleted = true
      totals.errorMessage = undefined
      break
    case 'error':
      totals.errorMessage = event.message
      break
    default:
      break
  }
}

/** Returns content eligible for the selected-output stream. */
export function streamTextForCodexEvent(event: CodexEvent): string | null {
  return event.type === 'text' ? event.text : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asFiniteNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function boundedSummary(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? truncate(trimmed, MAX_CODEX_TOOL_SUMMARY_CHARS) : undefined
}

function boundedOutput(value: string): string | undefined {
  if (!value) return undefined
  return truncate(value, MAX_CODEX_TOOL_OUTPUT_CHARS, '\n[output truncated]')
}

function itemFailure(item: Record<string, unknown>): boolean {
  const status = asString(item.status)
  const exitCode = item.exit_code
  return (
    status === 'failed' || status === 'declined' || (typeof exitCode === 'number' && exitCode !== 0)
  )
}

function fileChangeSummary(item: Record<string, unknown>): string | undefined {
  if (!Array.isArray(item.changes)) return undefined
  const changes = item.changes
    .map((change) => toRecordOrNull(change))
    .filter((change): change is Record<string, unknown> => change !== null)
    .map((change) => {
      const path = asString(change.path)
      const kind = asString(change.kind)
      return path ? `${kind || 'update'} ${path}` : ''
    })
    .filter(Boolean)
    .join(', ')
  return boundedSummary(changes)
}

function toolIdentity(item: Record<string, unknown>): { name: string; summary?: string } | null {
  switch (asString(item.type)) {
    case 'command_execution':
      return { name: 'command', summary: boundedSummary(asString(item.command)) }
    case 'file_change':
      return { name: 'file_change', summary: fileChangeSummary(item) }
    case 'mcp_tool_call': {
      const server = asString(item.server)
      const tool = asString(item.tool)
      return {
        name: [server, tool].filter(Boolean).join('/') || 'mcp_tool_call',
        summary: boundedSummary(asString(item.arguments)),
      }
    }
    case 'collab_tool_call':
      return {
        name: `collab:${asString(item.tool) || 'unknown'}`,
        summary: boundedSummary(asString(item.prompt)),
      }
    case 'web_search':
      return { name: 'web_search', summary: boundedSummary(asString(item.query)) }
    default:
      return null
  }
}

function normalizeItemEvent(
  wireType: 'item.started' | 'item.updated' | 'item.completed',
  rawItem: unknown
): CodexEvent[] {
  const item = toRecordOrNull(rawItem)
  if (!item) return [{ type: 'other' }]
  const id = asString(item.id)
  const itemType = asString(item.type)

  if (itemType === 'agent_message') {
    return wireType === 'item.completed'
      ? [{ type: 'text', text: asString(item.text) }]
      : [{ type: 'other' }]
  }
  if (itemType === 'reasoning') {
    return wireType === 'item.completed'
      ? [{ type: 'thinking', text: asString(item.text) }]
      : [{ type: 'other' }]
  }
  if (itemType === 'error') {
    return wireType === 'item.completed'
      ? [{ type: 'error', message: asString(item.message) || 'Codex item failed' }]
      : [{ type: 'other' }]
  }

  const tool = toolIdentity(item)
  if (!tool || !id || wireType === 'item.updated') return [{ type: 'other' }]
  if (wireType === 'item.started') {
    return [
      {
        type: 'tool_start',
        id,
        toolName: tool.name,
        ...(tool.summary ? { summary: tool.summary } : {}),
      },
    ]
  }

  return [
    {
      type: 'tool_end',
      id,
      toolName: tool.name,
      isError: itemFailure(item),
      ...(tool.summary ? { summary: tool.summary } : {}),
      ...(itemType === 'command_execution'
        ? { output: boundedOutput(asString(item.aggregated_output)) }
        : {}),
    },
  ]
}

/** Normalizes one decoded `codex exec --json` object. */
export function normalizeCodexEvent(raw: unknown): CodexEvent[] {
  const event = toRecordOrNull(raw)
  if (!event) return []

  switch (asString(event.type)) {
    case 'thread.started': {
      const threadId = asString(event.thread_id)
      return threadId ? [{ type: 'thread_started', threadId }] : [{ type: 'other' }]
    }
    case 'turn.started':
      return [{ type: 'turn_started' }]
    case 'turn.completed': {
      const usage = toRecordOrNull(event.usage)
      return [
        {
          type: 'usage',
          inputTokens: asFiniteNonNegativeInteger(usage?.input_tokens),
          cachedInputTokens: asFiniteNonNegativeInteger(usage?.cached_input_tokens),
          cacheWriteInputTokens: asFiniteNonNegativeInteger(usage?.cache_write_input_tokens),
          outputTokens: asFiniteNonNegativeInteger(usage?.output_tokens),
          reasoningOutputTokens: asFiniteNonNegativeInteger(usage?.reasoning_output_tokens),
        },
        { type: 'final' },
      ]
    }
    case 'turn.failed': {
      const error = toRecordOrNull(event.error)
      return [{ type: 'error', message: asString(error?.message) || 'Codex turn failed' }]
    }
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return normalizeItemEvent(
        asString(event.type) as 'item.started' | 'item.updated' | 'item.completed',
        event.item
      )
    case 'error':
      return [{ type: 'error', message: asString(event.message) || 'Codex run failed' }]
    default:
      return [{ type: 'other' }]
  }
}

/** Parses one JSONL line into zero or more normalized events. */
export function parseCodexJsonLine(line: string): CodexEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  try {
    return normalizeCodexEvent(JSON.parse(trimmed))
  } catch {
    return []
  }
}
