import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CompletionReportError,
  reportClientToolCompletion,
  reportClientToolCompletionOnPageExit,
} from '@/lib/mothership/tools/client/completion'

describe('client tool completion reporting', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds every normal confirmation attempt with an abortable deadline', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    fetchMock.mockImplementation((_input, init) => {
      const signal = init?.signal
      if (!signal) throw new Error('Expected an abort signal')
      signals.push(signal)
      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(signal.reason)
        signal.addEventListener('abort', rejectOnAbort, { once: true })
      })
    })

    const report = reportClientToolCompletion('tool-1', 'success')
    const rejection = expect(report).rejects.toBeInstanceOf(CompletionReportError)
    await vi.runAllTimersAsync()
    await rejection

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(signals).toHaveLength(5)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('stops at once when another client holds the call, instead of retrying a final answer', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }))
    let settled = false

    void reportClientToolCompletion('tool-1', 'error', 'Not run: delivered too late').then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toBe(true)
  })

  it('stops at once when the trimmed retry of an oversized report learns the call is held', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 413 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
    let settled = false

    void reportClientToolCompletion('tool-1', 'error', 'Failed', {
      logs: 'x'.repeat(11 * 1024 * 1024),
    }).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toBe(true)
  })

  it('uses a keepalive request with the exact terminal payload', async () => {
    await reportClientToolCompletionOnPageExit('tool-1', 'success', 'Browser action completed', {
      url: 'https://example.com',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          toolCallId: 'tool-1',
          status: 'success',
          message: 'Browser action completed',
          data: { url: 'https://example.com' },
        }),
      })
    )
  })

  it('bounds the unload-safe fallback with the same abortable deadline', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null = null
    fetchMock.mockImplementation((_input, init) => {
      signal = init?.signal ?? null
      if (!signal) throw new Error('Expected an abort signal')
      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(signal?.reason)
        signal?.addEventListener('abort', rejectOnAbort, { once: true })
      })
    })

    const report = reportClientToolCompletionOnPageExit(
      'tool-1',
      'success',
      'Browser action completed'
    )
    const rejection = expect(report).rejects.toBeInstanceOf(DOMException)
    await vi.runAllTimersAsync()
    await rejection

    expect(signal).not.toBeNull()
    expect(signal?.aborted).toBe(true)
  })

  it('treats a 409 as final: the desktop app holds the call', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }))

    await expect(
      reportClientToolCompletionOnPageExit('tool-1', 'error', 'Browser failed')
    ).resolves.toBeUndefined()
  })

  it('rejects a non-success response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(
      reportClientToolCompletionOnPageExit('tool-1', 'error', 'Browser failed')
    ).rejects.toBeInstanceOf(CompletionReportError)
  })
})
