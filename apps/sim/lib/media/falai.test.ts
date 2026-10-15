import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { downloadFalMedia, runFalQueue } from '@/lib/media/falai'

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

  it('submits nothing for a caller that already gave up', async () => {
    const fal = stubStuckFalQueue()

    await expect(
      runFalQueue('fal-ai/model', { prompt: 'p' }, 'key', AbortSignal.abort())
    ).rejects.toThrow()
    expect(fal.calls).toEqual([])
  })

  it('cancels a request its caller gave up on while submitting it', async () => {
    const calls: string[] = []
    let accept: (response: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? 'GET'} ${url}`)
        if (init.method === 'POST')
          return new Promise<Response>((resolve, reject) => {
            accept = resolve
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            })
          })
        return Promise.resolve(jsonResponse({ status: 'CANCELLATION_REQUESTED' }, 202))
      })
    )
    const caller = new AbortController()
    const generation = runFalQueue('fal-ai/model', { prompt: 'p' }, 'key', caller.signal).catch(
      () => 'rejected'
    )

    await vi.advanceTimersByTimeAsync(0)
    caller.abort(new Error('watchdog'))
    accept(jsonResponse({ request_id: 'req-1', cancel_url: CANCEL_URL }))

    expect(await generation).toBe('rejected')
    expect(calls).toContain(`PUT ${CANCEL_URL}`)
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

describe('downloadFalMedia', () => {
  it('ends a download still resolving its host once its caller gives up', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockImplementationOnce(
      (_url: string, _name: string, _profile: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          })
        })
    )
    const caller = new AbortController()
    const download = downloadFalMedia('https://media.example/out.mp3', caller.signal)

    caller.abort(new Error('watchdog'))

    await expect(download).rejects.toThrow('watchdog')
  })
})
