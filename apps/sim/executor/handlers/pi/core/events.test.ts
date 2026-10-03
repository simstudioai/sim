import { describe, expect, it } from 'vitest'
import {
  applyPiEvent,
  createPiTotals,
  normalizePiEvent,
  parseJsonLine,
} from '@/executor/handlers/pi/core/events'

describe('normalizePiEvent', () => {
  it('maps a settled agent failure to an error', () => {
    expect(
      normalizePiEvent({
        type: 'agent_end',
        willRetry: false,
        messages: [
          {
            role: 'assistant',
            stopReason: 'error',
            errorMessage: 'Invalid API key',
          },
        ],
      })
    ).toEqual({ type: 'error', message: 'Invalid API key' })
    expect(
      normalizePiEvent({
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'aborted' }],
      })
    ).toEqual({ type: 'error', message: 'Pi request aborted' })
  })

  it('does not fail an attempt that Pi will retry', () => {
    expect(
      normalizePiEvent({
        type: 'agent_end',
        willRetry: true,
        messages: [
          {
            role: 'assistant',
            stopReason: 'error',
            errorMessage: 'Provider overloaded',
          },
        ],
      })
    ).toEqual({ type: 'other' })
  })

  it('uses only text blocks from the last assistant message as final text', () => {
    expect(
      normalizePiEvent({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'Earlier narration' }],
          },
          { role: 'toolResult', content: [{ type: 'text', text: 'Tool output' }] },
          {
            role: 'assistant',
            stopReason: 'stop',
            content: [
              { type: 'thinking', thinking: 'Hidden reasoning' },
              { type: 'text', text: '# Plan' },
              { type: 'toolCall', name: 'read' },
              { type: 'text', text: 'Do it' },
            ],
          },
        ],
      })
    ).toEqual({ type: 'final', text: '# Plan\nDo it' })
  })
})

describe('parseJsonLine', () => {
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
