import { jsonResponse } from '@sim/testing/helpers/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runFalQueue } from '@/lib/media/falai'

const CANCEL_URL = 'https://queue.fal.run/fal-ai/model/requests/req-1/cancel'
const STATUS_URL = 'https://queue.fal.run/fal-ai/model/requests/req-1/status'

interface FalCall {
  url: string
  method: string
  headers: Record<string, string>
}

/**
 * A fal queue whose request is accepted and then never finishes: every status poll reports
 * IN_PROGRESS, or (`statusHangs`) never answers at all until its signal aborts.
 */
function stubStuckFalQueue(options: { statusHangs?: boolean } = {}) {
  const calls: FalCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
      })
      if (init.method === 'POST')
        return jsonResponse({
          request_id: 'req-1',
          status_url: STATUS_URL,
          cancel_url: CANCEL_URL,
        })
      if (init.method === 'PUT') return jsonResponse({ status: 'CANCELLATION_REQUESTED' }, 202)
      if (options.statusHangs)
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      return jsonResponse({ status: 'IN_PROGRESS' })
    })
  )
  const statusPolls = () => calls.filter((call) => call.url === STATUS_URL).length
  const cancels = () => calls.filter((call) => call.method === 'PUT')
  return { calls, statusPolls, cancels }
}

describe('runFalQueue on a request that never finishes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops polling and cancels the request once its caller gives up', async () => {
    const fal = stubStuckFalQueue()
    const caller = new AbortController()
    const generation = runFalQueue('fal-ai/model', { prompt: 'p' }, 'key', caller.signal)
    const outcome = generation.then(
      () => 'resolved',
      () => 'rejected'
    )

    await vi.advanceTimersByTimeAsync(9_500)
    expect(fal.statusPolls()).toBe(3)
    caller.abort(new Error('watchdog'))
    await vi.advanceTimersByTimeAsync(0)

    expect(await outcome).toBe('rejected')
    expect(fal.cancels()).toEqual([expect.objectContaining({ url: CANCEL_URL })])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fal.statusPolls()).toBe(3)
  })

  it('ends a poll that never answers when its caller gives up', async () => {
    const fal = stubStuckFalQueue({ statusHangs: true })
    const caller = new AbortController()
    const generation = runFalQueue('fal-ai/model', { prompt: 'p' }, 'key', caller.signal)
    const outcome = generation.then(
      () => 'resolved',
      () => 'rejected'
    )

    await vi.advanceTimersByTimeAsync(3_000)
    expect(fal.statusPolls()).toBe(1)
    caller.abort(new Error('watchdog'))
    await vi.advanceTimersByTimeAsync(0)

    expect(await outcome).toBe('rejected')
    expect(fal.cancels()).toHaveLength(1)
  })

  it('fails and cancels after its own ceiling even when nothing aborts it', async () => {
    const fal = stubStuckFalQueue()
    const generation = runFalQueue('fal-ai/model', { prompt: 'p' }, 'key')
    const outcome = generation.then(
      () => 'resolved',
      (error: unknown) => String(error)
    )

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    expect(await outcome).toContain('Fal.ai generation timed out')
    expect(fal.cancels()).toHaveLength(1)
  })

  it('asks fal never to start the request past that ceiling', async () => {
    const fal = stubStuckFalQueue()
    const caller = new AbortController()
    const generation = runFalQueue('fal-ai/model', { prompt: 'p' }, 'key', caller.signal).catch(
      () => undefined
    )
    await vi.advanceTimersByTimeAsync(0)
    caller.abort()
    await generation

    expect(fal.calls[0]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Fal-Request-Timeout': '1800' }),
    })
  })
})
