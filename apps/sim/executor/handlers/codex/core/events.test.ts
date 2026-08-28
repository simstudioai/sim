/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyCodexEvent,
  createCodexTotals,
  MAX_CODEX_TOOL_OUTPUT_CHARS,
  normalizeCodexEvent,
  parseCodexJsonLine,
  streamTextForCodexEvent,
} from '@/executor/handlers/codex/core/events'

function fixture(name: string): string[] {
  return readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
}

describe('Codex JSONL events', () => {
  it('parses the pinned successful-turn fixture and accumulates final totals', () => {
    const totals = createCodexTotals()
    const events = fixture('success').flatMap(parseCodexJsonLine)
    events.forEach((event) => applyCodexEvent(totals, event))

    expect(totals).toMatchObject({
      threadId: '019c9f8d-0bb8-7490-90c5-0514d2b465fe',
      finalText: '## Plan\n\n1. Update `src/a.ts`.',
      inputTokens: 120,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 10,
      outputTokens: 35,
      reasoningOutputTokens: 12,
      turnCompleted: true,
    })
    expect(totals.toolCalls).toEqual([
      {
        id: 'item-1',
        name: 'command',
        isError: false,
        summary: 'rg -n TODO src',
        output: 'src/a.ts:1:TODO\n',
      },
      {
        id: 'item-2',
        name: 'file_change',
        isError: false,
        summary: 'update src/a.ts',
      },
    ])
  })

  it('maps a failed turn to a redaction-ready error event', () => {
    const events = fixture('turn-failed').flatMap(parseCodexJsonLine)
    expect(events.at(-1)).toEqual({ type: 'error', message: 'The provided API key is invalid' })
  })

  it('treats turn.completed as terminal success after transient reconnect errors', () => {
    const totals = createCodexTotals()
    const events = fixture('reconnect-success').flatMap(parseCodexJsonLine)
    events.forEach((event) => applyCodexEvent(totals, event))

    expect(totals).toMatchObject({
      finalText: 'Recovered and completed',
      turnCompleted: true,
    })
    expect(totals.errorMessage).toBeUndefined()
  })

  it('maps failed and declined command outcomes to failed tool records', () => {
    expect(
      normalizeCodexEvent({
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'false',
          aggregated_output: 'failed',
          exit_code: 1,
          status: 'failed',
        },
      })
    ).toEqual([
      {
        type: 'tool_end',
        id: 'cmd-1',
        toolName: 'command',
        isError: true,
        summary: 'false',
        output: 'failed',
      },
    ])
  })

  it('bounds command output retained in block results', () => {
    const [event] = normalizeCodexEvent({
      type: 'item.completed',
      item: {
        id: 'cmd-1',
        type: 'command_execution',
        command: 'print-output',
        aggregated_output: 'x'.repeat(MAX_CODEX_TOOL_OUTPUT_CHARS + 10),
        exit_code: 0,
        status: 'completed',
      },
    })
    expect(event).toMatchObject({
      type: 'tool_end',
      output: expect.stringContaining('[output truncated]'),
    })
  })

  it('ignores malformed lines and unknown payloads safely', () => {
    expect(parseCodexJsonLine('')).toEqual([])
    expect(parseCodexJsonLine('{bad json')).toEqual([])
    expect(normalizeCodexEvent(null)).toEqual([])
    expect(normalizeCodexEvent({ type: 'future.event' })).toEqual([{ type: 'other' }])
  })

  it('streams agent messages only', () => {
    expect(streamTextForCodexEvent({ type: 'text', text: 'hello' })).toBe('hello')
    expect(streamTextForCodexEvent({ type: 'thinking', text: 'hidden' })).toBeNull()
  })
})
