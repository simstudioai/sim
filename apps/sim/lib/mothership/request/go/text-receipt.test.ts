import { describe, expect, it } from 'vitest'
import {
  FatalSseEventError,
  processSSEStream,
  StreamContinuityError,
} from '@/lib/mothership/request/go/parser'
import { reconcileTextEvent } from '@/lib/mothership/request/go/text-receipt'
import { parsePersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import type { StreamEvent } from '@/lib/mothership/request/types'

function text(content: string, textOffset: number): StreamEvent {
  return { type: 'text', payload: { channel: 'assistant', text: content, textOffset } }
}

describe('main-answer receipt boundary', () => {
  it('cancels the abandoned response body before retrying a continuity error', async () => {
    const gap = new StreamContinuityError('missing prefix')
    let cancelled: unknown
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {}\n\n'))
      },
      cancel(reason) {
        cancelled = reason
      },
    })
    await expect(
      processSSEStream(stream.getReader(), undefined, () => {
        throw gap
      })
    ).rejects.toBe(gap)
    expect(cancelled).toBe(gap)
    expect(stream.locked).toBe(false)
  })

  it('deduplicates full replay and trims matching Unicode overlap before delivery', () => {
    const received = 'Seen 🔎 café. '
    expect(reconcileTextEvent(text(received, 0), received)).toBeNull()
    expect(reconcileTextEvent(text('café. More', 'Seen 🔎 '.length), received)).toEqual(
      text('More', received.length)
    )
    expect(reconcileTextEvent(text('More', received.length), received)).toEqual(
      text('More', received.length)
    )
  })

  it('retries gaps but rejects a changed already-applied prefix', () => {
    expect(() => reconcileTextEvent(text('tail', 10), 'short')).toThrow(StreamContinuityError)
    expect(() => reconcileTextEvent(text('different', 0), 'seen')).toThrow(FatalSseEventError)
    expect(() => reconcileTextEvent(text('different', 0), 'seen')).not.toThrow(
      StreamContinuityError
    )
  })

  it('checks the final length so a missing last text frame cannot look complete', () => {
    const complete: StreamEvent = {
      type: 'complete',
      payload: { status: 'complete', textLength: 9 },
    }
    expect(() => reconcileTextEvent(complete, 'short')).toThrow(StreamContinuityError)
    expect(() => reconcileTextEvent(complete, 'too much text')).toThrow(FatalSseEventError)
    expect(reconcileTextEvent(complete, 'all text!')).toEqual(complete)
  })

  it('keeps child and thinking text outside the main receipt', () => {
    const child: StreamEvent = {
      ...text('child', 100),
      scope: { lane: 'subagent', parentToolCallId: 'child' },
    }
    const thinking: StreamEvent = {
      type: 'text',
      payload: { channel: 'thinking', text: 'thinking', textOffset: 100 },
    }
    expect(reconcileTextEvent(child, '')).toEqual(child)
    expect(reconcileTextEvent(thinking, '')).toEqual(thinking)
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '4'])(
    'rejects malformed offsets at the wire boundary: %s',
    (textOffset) => {
      const parsed = parsePersistedStreamEventEnvelope({
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        stream: { streamId: 'run' },
        type: 'text',
        payload: { channel: 'assistant', text: 'data', textOffset },
      })
      expect(
        parsePersistedStreamEventEnvelope({
          v: 1,
          seq: 1,
          ts: new Date().toISOString(),
          stream: { streamId: 'run' },
          type: 'text',
          payload: { channel: 'assistant', text: 'data', textOffset: 0 },
        }).ok
      ).toBe(true)
      expect(parsed.ok).toBe(false)
    }
  )
})
