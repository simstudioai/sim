/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type AgentStreamEvent,
  createAgentEventReadableStream,
  isAgentStreamEvent,
  isTextDeltaTurn,
  isToolCallEndStatus,
} from '@/providers/stream-events'

describe('stream-events contract', () => {
  describe('isAgentStreamEvent', () => {
    it('accepts valid event variants', () => {
      const events: AgentStreamEvent[] = [
        { type: 'text_delta', text: 'hi' },
        { type: 'text_delta', text: 'mid', turn: 'intermediate' },
        { type: 'text_delta', text: 'bye', turn: 'final' },
        { type: 'text_delta', text: 'live', turn: 'pending' },
        { type: 'turn_end', turn: 'intermediate' },
        { type: 'turn_end', turn: 'final' },
        { type: 'thinking_delta', text: 'hmm' },
        { type: 'tool_call_start', id: 't1', name: 'search' },
        { type: 'tool_call_end', id: 't1', name: 'search', status: 'success' },
        { type: 'tool_call_end', id: 't1', name: 'search', status: 'error' },
        { type: 'tool_call_end', id: 't1', name: 'search', status: 'cancelled' },
      ]

      for (const event of events) {
        expect(isAgentStreamEvent(event)).toBe(true)
      }
    })

    it('rejects malformed events', () => {
      expect(isAgentStreamEvent(null)).toBe(false)
      expect(isAgentStreamEvent({ type: 'error', message: 'x' })).toBe(false)
      expect(isAgentStreamEvent({ type: 'text_delta' })).toBe(false)
      expect(isAgentStreamEvent({ type: 'text_delta', text: 'x', turn: 'other' })).toBe(false)
      // turn_end classifies a settled turn — 'pending' is not a valid classification.
      expect(isAgentStreamEvent({ type: 'turn_end', turn: 'pending' })).toBe(false)
      expect(isAgentStreamEvent({ type: 'turn_end' })).toBe(false)
      expect(isAgentStreamEvent({ type: 'tool_call_start', id: 't1' })).toBe(false)
      expect(
        isAgentStreamEvent({ type: 'tool_call_end', id: 't1', name: 'search', status: 'ok' })
      ).toBe(false)
    })
  })

  describe('status and turn guards', () => {
    it('validates tool end statuses and text turns', () => {
      expect(isToolCallEndStatus('success')).toBe(true)
      expect(isToolCallEndStatus('failed')).toBe(false)
      expect(isTextDeltaTurn('final')).toBe(true)
      expect(isTextDeltaTurn('first')).toBe(false)
    })
  })

  describe('createAgentEventReadableStream', () => {
    it('enqueues events in order and closes', async () => {
      const events: AgentStreamEvent[] = [
        { type: 'thinking_delta', text: 'a' },
        { type: 'text_delta', text: 'b', turn: 'final' },
        { type: 'tool_call_start', id: '1', name: 'lookup' },
        { type: 'tool_call_end', id: '1', name: 'lookup', status: 'success' },
      ]

      const stream = createAgentEventReadableStream(events)
      const reader = stream.getReader()
      const received: AgentStreamEvent[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received.push(value)
      }

      expect(received).toEqual(events)
    })

    it('errors when an invalid object is yielded', async () => {
      async function* bad() {
        yield { type: 'text_delta', text: 'ok' } as AgentStreamEvent
        yield { type: 'nope' } as unknown as AgentStreamEvent
      }

      const stream = createAgentEventReadableStream(bad())
      const reader = stream.getReader()

      await expect(reader.read()).resolves.toMatchObject({
        done: false,
        value: { type: 'text_delta', text: 'ok' },
      })
      await expect(reader.read()).rejects.toThrow(/Invalid AgentStreamEvent/)
    })
  })
})
