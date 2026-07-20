/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createSSEStream } from '@/lib/events/sse-endpoint'

describe('createSSEStream', () => {
  it('frames named events and releases the subscription when the client disconnects', async () => {
    const unsubscribe = vi.fn()
    const response = createSSEStream({
      label: 'test-events',
      request: new Request('http://localhost/events'),
      maxBufferedBytes: 1024,
      subscribe: (send) => {
        send('ready', { connected: true })
        send('update', { sequence: 1 })
        send('update', { sequence: 2 })
        return unsubscribe
      },
    })

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    if (!response.body) throw new Error('Expected an SSE response body')

    const reader = response.body.getReader()
    const first = await reader.read()
    const second = await reader.read()
    const third = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('event: ready\ndata: {"connected":true}\n\n')
    expect(new TextDecoder().decode(second.value)).toBe('event: update\ndata: {"sequence":1}\n\n')
    expect(new TextDecoder().decode(third.value)).toBe('event: update\ndata: {"sequence":2}\n\n')

    await reader.cancel()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('releases a subscription when its initial event exceeds the bounded queue', async () => {
    const unsubscribe = vi.fn()
    const response = createSSEStream({
      label: 'test-events',
      request: new Request('http://localhost/events'),
      maxBufferedBytes: 1,
      subscribe: (send) => {
        send('ready', { connected: true })
        return unsubscribe
      },
    })

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    if (!response.body) throw new Error('Expected an SSE response body')
    await expect(response.body.getReader().read()).rejects.toThrow(
      'SSE client fell behind the live event stream'
    )
  })

  it('rotates long-lived connections so the next connection reauthorizes', async () => {
    vi.useFakeTimers()
    try {
      const unsubscribe = vi.fn()
      const response = createSSEStream({
        label: 'test-events',
        request: new Request('http://localhost/events'),
        maxConnectionDurationMs: 100,
        subscribe: () => unsubscribe,
      })

      if (!response.body) throw new Error('Expected an SSE response body')
      const reader = response.body.getReader()
      await vi.advanceTimersByTimeAsync(100)

      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
