import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { downloadFalMedia, type FalCostRecorder, runFalQueue } from '@/lib/media/falai'
import { generateFalAudio } from '@/lib/media/falai-audio'
import { generateFalVideo } from '@/lib/media/falai-video'

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
function stubStuckFalQueue(options: { statusHangs?: boolean; cancelStatus?: number } = {}) {
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
      if (init.method === 'PUT')
        return jsonResponse({ status: 'CANCELLATION_REQUESTED' }, options.cancelStatus ?? 202)
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

  it('warns when fal refuses to cancel a request', async () => {
    const fal = stubStuckFalQueue({ cancelStatus: 500 })
    const caller = new AbortController()
    const generation = runFalQueue('fal-ai/model', { prompt: 'p' }, 'key', caller.signal).catch(
      () => undefined
    )
    await vi.advanceTimersByTimeAsync(3_500)
    caller.abort()
    await generation

    expect(fal.cancels()).toHaveLength(1)
    expect(getMockLogger('FalMediaClient').warn).toHaveBeenCalledWith(
      'Fal.ai request cancellation failed',
      expect.objectContaining({ requestId: 'req-1' })
    )
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
  it('returns nothing for a caller that already gave up, even inline media', async () => {
    await expect(
      downloadFalMedia('data:audio/mpeg;base64,AAAA', AbortSignal.abort())
    ).rejects.toThrow()
  })

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

const MEDIA_URL = 'https://media.example/out.bin'
const BILLED_NANO_USD = 40_000_000

/**
 * A fal queue whose request completes on the first poll. The billing-event lookup answers at
 * once, answers only once `answered` settles (whatever its caller does), or (`hangs`) never.
 */
function stubCompletedFalQueue(
  billing: { answered?: Promise<void>; hangs?: boolean } = {},
  result: Record<string, unknown> = { audio: { url: MEDIA_URL }, video: { url: MEDIA_URL } }
) {
  const billingLookups: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input)
      if (url === STATUS_URL) return jsonResponse({ status: 'COMPLETED' })
      if (url.endsWith('/requests/req-1/response')) return jsonResponse(result)
      if (!url.startsWith('https://api.fal.ai/v1/models/billing-events'))
        return jsonResponse({ request_id: 'req-1', status_url: STATUS_URL })
      billingLookups.push(url)
      if (billing.hangs)
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      await billing.answered
      return jsonResponse({
        billing_events: [
          {
            request_id: 'req-1',
            endpoint_id: 'fal-ai/model',
            cost_estimate_nano_usd: BILLED_NANO_USD,
          },
        ],
      })
    })
  )
  return { billingLookups }
}

/** The generated media's host resolves; the download then answers with `download`. */
function stubMediaHost(download: (options: { signal?: AbortSignal }) => Promise<Response>) {
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
    isValid: true,
    resolvedIP: '203.0.113.1',
  })
  inputValidationMockFns.mockSecureFetchWithPinnedIP.mockImplementationOnce(
    (_url: string, _ip: string, options: { signal?: AbortSignal }) => download(options)
  )
}

const downloadAudio = async () =>
  new Response('audio', { headers: { 'content-type': 'audio/mpeg' } })

const startAudio = (onCost: FalCostRecorder, signal?: AbortSignal) =>
  generateFalAudio({ prompt: 'p', model: 'fal-ai/model', signal, onCost })

const generators = [
  ['audio', startAudio],
  [
    'video',
    (onCost: FalCostRecorder, signal?: AbortSignal) =>
      generateFalVideo({ prompt: 'p', signal, onCost }),
  ],
] as const

describe('billing a fal generation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('FALAI_API_KEY', 'key')
  })
  afterEach(() => {
    vi.useRealTimers()
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset()
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockReset()
  })

  it.each(generators)(
    'bills a completed %s generation once when a Stop ends its download',
    async (_kind, generate) => {
      stubCompletedFalQueue()
      stubMediaHost(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )
      const onCost = vi.fn().mockResolvedValue(undefined)
      const caller = new AbortController()
      const generation = generate(onCost, caller.signal).catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(3_000)
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalled()
      caller.abort(new Error('watchdog'))

      expect(await generation).toEqual(new Error('watchdog'))
      expect(onCost).toHaveBeenCalledTimes(1)
      expect(onCost).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'billing_events', costDollars: 0.04 })
      )
    }
  )

  it.each(generators)(
    'bills a completed %s generation once when its result has no media URL',
    async (_kind, generate) => {
      stubCompletedFalQueue({}, { unexpected: true })
      const onCost = vi.fn().mockResolvedValue(undefined)
      const generation = generate(onCost).catch((error: unknown) => String(error))

      await vi.advanceTimersByTimeAsync(3_000)

      expect(await generation).toMatch(/No (audio|video) URL/)
      expect(onCost).toHaveBeenCalledTimes(1)
      expect(onCost).toHaveBeenCalledWith(expect.objectContaining({ source: 'billing_events' }))
    }
  )

  it('finishes the cost lookup of a completed generation a Stop lands in, then stops', async () => {
    const billingAnswer = createDeferred<void>()
    const fal = stubCompletedFalQueue({ answered: billingAnswer.promise })
    stubMediaHost(downloadAudio)
    const onCost = vi.fn().mockResolvedValue(undefined)
    const caller = new AbortController()
    const generation = startAudio(onCost, caller.signal).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(fal.billingLookups).toHaveLength(1)
    caller.abort(new Error('watchdog'))
    billingAnswer.resolve()

    expect(await generation).toEqual(new Error('watchdog'))
    expect(onCost).toHaveBeenCalledTimes(1)
    expect(onCost).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'billing_events', costDollars: 0.04 })
    )
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('bills the fallback floor once when the cost lookup outlasts its own bound', async () => {
    stubCompletedFalQueue({ hangs: true })
    stubMediaHost(downloadAudio)
    const onCost = vi.fn().mockResolvedValue(undefined)
    const caller = new AbortController()
    const generation = startAudio(onCost, caller.signal).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(3_000)
    caller.abort(new Error('watchdog'))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(onCost).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(await generation).toEqual(new Error('watchdog'))
    expect(onCost).toHaveBeenCalledTimes(1)
    expect(onCost).toHaveBeenCalledWith(expect.objectContaining({ source: 'fallback_floor' }))
  })

  it('bills a generation that completes and downloads exactly once', async () => {
    stubCompletedFalQueue()
    stubMediaHost(downloadAudio)
    const onCost = vi.fn().mockResolvedValue(undefined)
    const generation = startAudio(onCost)

    await vi.advanceTimersByTimeAsync(3_000)
    const audio = await generation

    expect(audio.buffer.toString()).toBe('audio')
    expect(onCost).toHaveBeenCalledTimes(1)
    expect(onCost).toHaveBeenCalledWith(audio.cost)
  })

  it('bills nothing for a generation stopped before fal completes it', async () => {
    const fal = stubStuckFalQueue()
    const onCost = vi.fn().mockResolvedValue(undefined)
    const caller = new AbortController()
    const generation = startAudio(onCost, caller.signal).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(3_500)
    caller.abort(new Error('watchdog'))

    expect(await generation).toEqual(new Error('watchdog'))
    expect(fal.cancels()).toHaveLength(1)
    expect(onCost).not.toHaveBeenCalled()
  })
})

describe('the speech request fal receives', () => {
  beforeEach(() => {
    vi.stubEnv('FALAI_API_KEY', 'key')
  })

  /** fal validates the submit body and rejects it; the stub records what was submitted. */
  function stubRejectingFalSubmit() {
    const submitted: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        submitted.push({ url, body: JSON.parse(String(init.body)) })
        return jsonResponse({ detail: 'rejected by stub' }, 422)
      })
    )
    return submitted
  }

  it.each([
    ['fal-ai/elevenlabs/tts/eleven-v3', { text: 'Hello there', voice: 'Aria' }],
    ['fal-ai/elevenlabs/tts/multilingual-v2', { text: 'Hello there', voice: 'Aria' }],
    [undefined, { prompt: 'Hello there', voice: 'Kore' }],
  ])('submits the text %s requires', async (model, expectedBody) => {
    const submitted = stubRejectingFalSubmit()

    await expect(
      generateFalAudio({
        prompt: 'Hello there',
        voice: expectedBody.voice,
        model,
        onCost: vi.fn(),
      })
    ).rejects.toThrow()

    expect(submitted).toEqual([
      {
        url: `https://queue.fal.run/${model ?? 'fal-ai/gemini-3.1-flash-tts'}`,
        body: expectedBody,
      },
    ])
  })

  it.each([
    ['an explicit Gemini TTS', 'fal-ai/gemini-3.1-flash-tts'],
    ['the default speech', undefined],
  ])(
    'refuses a voice %s model does not offer without submitting, naming the voices it does',
    async (_label, model) => {
      const submitted = stubRejectingFalSubmit()

      const failure = generateFalAudio({
        prompt: 'Hello there',
        voice: 'Brian',
        model,
        onCost: vi.fn(),
      })

      await expect(failure).rejects.toThrow('Voice "Brian" is not available')
      await expect(failure).rejects.toThrow('Kore')
      expect(submitted).toEqual([])
    }
  )
})
