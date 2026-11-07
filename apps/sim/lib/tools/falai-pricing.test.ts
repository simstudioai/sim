import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { utilsHelpersMock } from '@sim/testing/mocks/utils-helpers.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS,
  FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS,
  FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS,
  getFalAICostMetadata,
} from '@/lib/tools/falai-pricing'

// Avoid the real inter-attempt backoff so the fallback path resolves instantly.
vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

describe('getFalAICostMetadata fallback floor', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 500 }))
    )
  })

  it.each([
    ['fal-ai/f5-tts', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/gemini-3.1-flash-tts', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/minimax-music/v2.6', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/elevenlabs/sound-effects/v2', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/nano-banana', FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/veo-3.1', FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/seedance-2.0', FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/kling-video/v3/pro/image-to-video', FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['blackforestlabs/flux-3/image-to-video', FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS],
  ])('uses the correct provider-cost floor for %s', async (endpointId, expected) => {
    const result = await getFalAICostMetadata({
      apiKey: 'test-key',
      endpointId,
      requestId: 'req_123',
    })

    expect(result.source).toBe('fallback_floor')
    expect(result.costDollars).toBe(expected)
  })

  it('bills the floor when the pricing estimate answers with an unreadable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('pricing/estimate')
          ? new Response('not json', { status: 200 })
          : new Response('error', { status: 500 })
      )
    )

    const result = await getFalAICostMetadata({
      apiKey: 'test-key',
      endpointId: 'fal-ai/veo-3.1',
      requestId: 'req_123',
    })

    expect(result.source).toBe('fallback_floor')
    expect(result.costDollars).toBe(FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS)
  })
})

describe('Fal pricing bursts', () => {
  let lookup = getFalAICostMetadata

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.resetModules()
    lookup = (await import('@/lib/tools/falai-pricing')).getFalAICostMetadata
  })

  afterEach(() => vi.useRealTimers())

  it('coalesces historical estimates while keeping receipts per job and credential', async () => {
    const estimates: string[] = []
    const receipts: string[] = []
    let accountCost = 0
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('billing-events')) {
        const id = new URL(url).searchParams.get('request_id') || ''
        receipts.push(id)
        return jsonResponse({
          billing_events:
            id === 'exact'
              ? [
                  {
                    request_id: id,
                    endpoint_id: 'fal-ai/flux',
                    cost_estimate_nano_usd: 90000000,
                  },
                ]
              : [],
        })
      }
      const key = new Headers(init?.headers).get('Authorization') || ''
      estimates.push(key)
      return jsonResponse({ total_cost: key === 'Key account-a' ? accountCost : 0.3 })
    })
    const request = (requestId: string, apiKey = 'account-a', endpointId = 'fal-ai/flux') =>
      lookup({ apiKey, endpointId, requestId })
    const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => request(`job-${i}`)))
    expect(
      burst.every((cost) => cost.source === 'historical_estimate' && cost.costDollars === 0)
    ).toBe(true)
    expect(estimates).toEqual(['Key account-a'])
    accountCost = 0.6
    expect(await request('cached')).toMatchObject({ costDollars: 0, source: 'historical_estimate' })
    expect(await request('exact')).toMatchObject({
      requestId: 'exact',
      costDollars: 0.09,
      source: 'billing_events',
    })
    expect(await request('other-account', 'account-b')).toMatchObject({ costDollars: 0.3 })
    await request('other-model', 'account-a', 'fal-ai/nano-banana')
    expect(estimates).toEqual(['Key account-a', 'Key account-b', 'Key account-a'])
    expect(new Set(receipts).size).toBe(24)
    await vi.advanceTimersByTimeAsync(300001)
    expect(await request('expired')).toMatchObject({
      costDollars: 0.6,
      source: 'historical_estimate',
    })
    expect(estimates).toHaveLength(4)
  })

  it('honors account-scoped Retry-After across endpoints and resumes after expiry', async () => {
    const estimates: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('billing-events')) return jsonResponse({ billing_events: [] })
      const key = new Headers(init?.headers).get('Authorization') || ''
      estimates.push(key)
      return estimates.length === 1
        ? new Response('sensitive provider body', {
            status: 429,
            headers: { 'Retry-After': '120' },
          })
        : jsonResponse({ total_cost: 0.12 })
    })
    const request = (endpointId: string, apiKey = 'limited-key') =>
      lookup({ apiKey, endpointId, requestId: endpointId })
    const limited = await request('fal-ai/flux')
    expect(limited.source).toBe('fallback_floor')
    expect(limited.error).not.toContain('sensitive provider body')
    await request('fal-ai/nano-banana')
    expect(estimates).toHaveLength(1)
    expect(await request('fal-ai/flux', 'other-key')).toMatchObject({ costDollars: 0.12 })
    await vi.advanceTimersByTimeAsync(119000)
    await request('fal-ai/flux')
    expect(estimates).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await request('fal-ai/flux')).toMatchObject({
      source: 'historical_estimate',
      costDollars: 0.12,
    })
    expect(estimates).toHaveLength(3)
  })

  it('does not shorten an active cooldown when concurrent endpoints receive different Retry-After values', async () => {
    let estimates = 0
    const second = createDeferred<Response>()
    const started = createDeferred<void>()
    vi.stubGlobal('fetch', async (url: string | URL) => {
      if (String(url).includes('billing-events')) return jsonResponse({ billing_events: [] })
      estimates++
      if (estimates === 1)
        return new Response(null, { status: 429, headers: { 'Retry-After': '120' } })
      if (estimates === 2) {
        started.resolve()
        return second.promise
      }
      return jsonResponse({ total_cost: 0.2 })
    })
    const request = (endpointId: string) =>
      lookup({ apiKey: 'shared-account', endpointId, requestId: endpointId })
    const firstLookup = request('fal-ai/flux')
    const secondLookup = request('fal-ai/nano-banana')
    await started.promise
    await firstLookup
    second.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
    await secondLookup
    await vi.advanceTimersByTimeAsync(2000)
    expect(await request('fal-ai/other')).toMatchObject({ source: 'fallback_floor' })
    expect(estimates).toBe(2)
    await vi.advanceTimersByTimeAsync(118001)
    expect(await request('fal-ai/other')).toMatchObject({
      source: 'historical_estimate',
      costDollars: 0.2,
    })
  })

  it('backs off forbidden billing-event reads without blocking historical estimates', async () => {
    let reads = 0
    vi.stubGlobal('fetch', async (url: string | URL) => {
      if (String(url).includes('billing-events')) {
        reads++
        return new Response(null, { status: 403 })
      }
      return jsonResponse({ total_cost: 0.2 })
    })
    for (const requestId of ['one', 'two']) {
      expect(
        await lookup({ apiKey: 'limited-scope', endpointId: 'fal-ai/flux', requestId })
      ).toMatchObject({ costDollars: 0.2 })
    }
    expect(reads).toBe(1)
  })

  it('never bills a receipt for a different request', async () => {
    vi.stubGlobal('fetch', async (url: string | URL) =>
      String(url).includes('billing-events')
        ? jsonResponse({
            billing_events: [
              {
                request_id: 'unrelated',
                endpoint_id: 'fal-ai/flux',
                cost_estimate_nano_usd: 8000000000,
              },
            ],
          })
        : jsonResponse({ total_cost: 0.1 })
    )
    expect(
      await lookup({ apiKey: 'key', endpointId: 'fal-ai/flux', requestId: 'mine' })
    ).toMatchObject({ requestId: 'mine', source: 'historical_estimate', costDollars: 0.1 })
  })

  it('retains a successful shared price after its only waiter stops', async () => {
    const response = createDeferred<Response>()
    const started = createDeferred<void>()
    let estimates = 0
    vi.stubGlobal('fetch', async (url: string | URL) => {
      if (String(url).includes('billing-events')) return jsonResponse({ billing_events: [] })
      estimates++
      started.resolve()
      return estimates === 1 ? response.promise : jsonResponse({ total_cost: 0.9 })
    })
    const controller = new AbortController()
    const args = { apiKey: 'stopped-account', endpointId: 'fal-ai/flux' }
    const stopped = lookup({ ...args, requestId: 'stopped', signal: controller.signal })
    const rejected = expect(stopped).rejects.toThrow('Stopped')
    await started.promise
    controller.abort(new Error('Stopped'))
    await rejected
    response.resolve(jsonResponse({ total_cost: 0.2 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(await lookup({ ...args, requestId: 'later' })).toMatchObject({ costDollars: 0.2 })
    expect(estimates).toBe(1)
  })

  it('isolates a cancelled waiter from a shared estimate and bounds hung producers', async () => {
    const pending = createDeferred<Response>()
    const started = createDeferred<void>()
    let estimates = 0
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('billing-events')) return jsonResponse({ billing_events: [] })
      estimates++
      started.resolve()
      init?.signal?.addEventListener('abort', () => pending.reject(init.signal?.reason), {
        once: true,
      })
      return pending.promise
    })
    const controller = new AbortController()
    const args = { apiKey: 'key', endpointId: 'fal-ai/flux' }
    const cancelled = lookup({ ...args, requestId: 'cancelled', signal: controller.signal })
    const rejected = expect(cancelled).rejects.toThrow('Stopped')
    const survivor = lookup({ ...args, requestId: 'survivor' })
    await started.promise
    controller.abort(new Error('Stopped'))
    await rejected
    pending.resolve(jsonResponse({ total_cost: 0.2 }))
    expect(await survivor).toMatchObject({ costDollars: 0.2 })
    expect(estimates).toBe(1)

    const lateResponse = createDeferred<Response>()
    vi.stubGlobal('fetch', async (url: string | URL) =>
      String(url).includes('billing-events')
        ? jsonResponse({ billing_events: [] })
        : lateResponse.promise
    )
    const hung = lookup({ ...args, endpointId: 'fal-ai/hung', requestId: 'hung' })
    await vi.advanceTimersByTimeAsync(10001)
    expect(await hung).toMatchObject({ source: 'fallback_floor' })
    vi.stubGlobal('fetch', async (url: string | URL) =>
      String(url).includes('billing-events')
        ? jsonResponse({ billing_events: [] })
        : jsonResponse({ total_cost: 0.4 })
    )
    expect(
      await lookup({ ...args, endpointId: 'fal-ai/hung', requestId: 'recovered' })
    ).toMatchObject({ costDollars: 0.4 })
    lateResponse.resolve(jsonResponse({ total_cost: 0.9 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(
      await lookup({ ...args, endpointId: 'fal-ai/hung', requestId: 'after-late' })
    ).toMatchObject({ costDollars: 0.4 })
  })
})
