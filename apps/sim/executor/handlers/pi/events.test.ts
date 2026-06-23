/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applyPiEvent,
  createPiTotals,
  normalizePiEvent,
  parseJsonLine,
  streamTextForEvent,
} from '@/executor/handlers/pi/events'

describe('normalizePiEvent', () => {
  it('maps a text_delta message_update to a text event', () => {
    expect(
      normalizePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      })
    ).toEqual({ type: 'text', text: 'hello' })
  })

  it('maps a thinking_delta message_update to a thinking event', () => {
    expect(
      normalizePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      })
    ).toEqual({ type: 'thinking', text: 'hmm' })
  })

  it('maps tool execution start and end', () => {
    expect(normalizePiEvent({ type: 'tool_execution_start', toolName: 'bash' })).toEqual({
      type: 'tool_start',
      toolName: 'bash',
    })
    expect(
      normalizePiEvent({ type: 'tool_execution_end', toolName: 'bash', isError: true })
    ).toEqual({
      type: 'tool_end',
      toolName: 'bash',
      isError: true,
    })
  })

  it('extracts usage from turn_end via message.usage and direct usage', () => {
    expect(
      normalizePiEvent({ type: 'turn_end', message: { usage: { input: 5, output: 7 } } })
    ).toEqual({ type: 'usage', inputTokens: 5, outputTokens: 7 })
    expect(
      normalizePiEvent({ type: 'turn_end', usage: { prompt_tokens: 3, completion_tokens: 2 } })
    ).toEqual({ type: 'usage', inputTokens: 3, outputTokens: 2 })
  })

  it('maps agent_end to final and error to error', () => {
    expect(normalizePiEvent({ type: 'agent_end' })).toEqual({ type: 'final' })
    expect(normalizePiEvent({ type: 'error', error: 'boom' })).toEqual({
      type: 'error',
      message: 'boom',
    })
  })

  it('returns other for unknown types and null for non-objects', () => {
    expect(normalizePiEvent({ type: 'queue_update' })).toEqual({ type: 'other' })
    expect(normalizePiEvent('nope')).toBeNull()
    expect(normalizePiEvent(null)).toBeNull()
  })
})

describe('parseJsonLine', () => {
  it('parses a valid json line', () => {
    expect(parseJsonLine('{"type":"agent_end"}')).toEqual({ type: 'final' })
  })

  it('returns null for blank or malformed lines', () => {
    expect(parseJsonLine('   ')).toBeNull()
    expect(parseJsonLine('{not json')).toBeNull()
  })
})

describe('applyPiEvent', () => {
  it('accumulates text, sums usage, records tool calls and errors', () => {
    const totals = createPiTotals()
    applyPiEvent(totals, { type: 'text', text: 'a' })
    applyPiEvent(totals, { type: 'text', text: 'b' })
    applyPiEvent(totals, { type: 'usage', inputTokens: 3, outputTokens: 4 })
    applyPiEvent(totals, { type: 'usage', inputTokens: 1, outputTokens: 1 })
    applyPiEvent(totals, { type: 'tool_end', toolName: 'read', isError: false })
    applyPiEvent(totals, { type: 'error', message: 'boom' })

    expect(totals.finalText).toBe('ab')
    expect(totals.inputTokens).toBe(4)
    expect(totals.outputTokens).toBe(5)
    expect(totals.toolCalls).toEqual([{ name: 'read', isError: false }])
    expect(totals.errorMessage).toBe('boom')
  })

  it('uses final text only when no streamed text was seen', () => {
    const empty = createPiTotals()
    applyPiEvent(empty, { type: 'final', text: 'fallback' })
    expect(empty.finalText).toBe('fallback')

    const streamed = createPiTotals()
    applyPiEvent(streamed, { type: 'text', text: 'streamed' })
    applyPiEvent(streamed, { type: 'final', text: 'fallback' })
    expect(streamed.finalText).toBe('streamed')
  })
})

describe('streamTextForEvent', () => {
  it('returns text for text events and null otherwise', () => {
    expect(streamTextForEvent({ type: 'text', text: 'x' })).toBe('x')
    expect(streamTextForEvent({ type: 'thinking', text: 'x' })).toBeNull()
    expect(streamTextForEvent({ type: 'final' })).toBeNull()
  })
})
