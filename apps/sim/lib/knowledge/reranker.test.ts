/**
 * @vitest-environment node
 */
import { setupGlobalFetchMock } from '@sim/testing/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AtomicAdmissionOptions,
  TokenBucketReservation,
} from '@/lib/core/rate-limiter/storage/adapter'

const admission = vi.hoisted(() => ({
  consume: vi.fn(),
  setCooldown: vi.fn(),
  cooldowns: new Map<string, Date>(),
}))
vi.mock('@/lib/core/rate-limiter/storage/factory', () => ({
  createStorageAdapter: () => ({
    consumeTokensAtomically: admission.consume,
    getCooldownUntil: async (key: string) => admission.cooldowns.get(key) ?? null,
    setCooldownUntil: admission.setCooldown,
  }),
}))

import { env } from '@/lib/core/config/env'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { rerank } from '@/lib/knowledge/reranker'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const envSnapshot = { ...env }

describe('Knowledge reranker model boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    admission.cooldowns.clear()
    admission.consume.mockImplementation(
      async (_reservations: readonly TokenBucketReservation[], options: AtomicAdmissionOptions) => {
        const until = Math.max(
          0,
          ...options.cooldownKeys.map((key) => admission.cooldowns.get(key)?.getTime() ?? 0)
        )
        return { allowed: until <= Date.now(), retryAfterMs: Math.max(0, until - Date.now()) }
      }
    )
    admission.setCooldown.mockImplementation(async (key: string, until: Date) => {
      admission.cooldowns.set(
        key,
        new Date(Math.max(until.getTime(), admission.cooldowns.get(key)?.getTime() ?? 0))
      )
    })
    setupGlobalFetchMock().mockImplementation(async () =>
      Response.json({ results: [{ index: 0, relevance_score: 0.9 }] })
    )
    env.COHERE_API_KEY = 'cohere-key'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key]
    Object.assign(env, envSnapshot)
  })

  it('projects query and documents at egress while returning the original item', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')
    const item = { id: 'chunk-1', text: 'stored secret-value content' }

    const result = await runWithKnowledgeModelInputProvenance(registry, () =>
      rerank('find secret-value', [item], {
        model: 'rerank-v4.0-fast',
        topN: 1,
      })
    )

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api.cohere.com/v2/rerank',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'rerank-v4.0-fast',
          query: 'find {{TOKEN}}',
          documents: ['stored {{TOKEN}} content'],
          top_n: 1,
        }),
      })
    )
    expect(result.results[0]?.item).toBe(item)
    expect(result.results[0]?.item.text).toBe('stored secret-value content')
  })

  it('cancels a stalled response body when the caller aborts without retrying', async () => {
    const cancelled = vi.fn()
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })))
    const controller = new AbortController()
    const result = rerank('query', [{ id: 'one', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      signal: controller.signal,
    })
    const rejection = expect(result).rejects.toThrow('Fixture cancelled')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    controller.abort(new Error('Fixture cancelled'))
    await rejection
    expect(cancelled).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { timeoutMs: undefined, expectedMs: 30_000 },
    { timeoutMs: 3000, expectedMs: 3000 },
  ])('bounds a stalled response body to $expectedMs ms', async ({ timeoutMs, expectedMs }) => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })))
    const result = rerank('query', [{ id: 'one', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      timeoutMs,
    })
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(expectedMs - 1)
    expect(cancelled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(cancelled).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { timeoutMs: undefined, expectedMs: 30_000 },
    { timeoutMs: 3000, expectedMs: 3000 },
  ])(
    'aborts stalled response headers at $expectedMs ms without retrying',
    async ({ timeoutMs, expectedMs }) => {
      vi.useFakeTimers()
      const aborted = vi.fn()
      vi.mocked(fetch).mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted()
                reject(init.signal?.reason)
              },
              { once: true }
            )
          })
      )
      const pending = rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
        timeoutMs,
      })
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(expectedMs - 1)
      expect(aborted).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(aborted).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each([
    { timeoutMs: undefined, expectedMs: 30_000 },
    { timeoutMs: 3000, expectedMs: 3000 },
  ])(
    'bounds stalled admission storage to $expectedMs ms and prevents late provider calls',
    async ({ timeoutMs, expectedMs }) => {
      vi.useFakeTimers()
      const stored = Promise.withResolvers<{ allowed: boolean; retryAfterMs: number }>()
      admission.consume.mockReturnValue(stored.promise)
      const pending = rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
        timeoutMs,
      })
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(expectedMs)
      await rejected
      stored.resolve({ allowed: true, retryAfterMs: 0 })
      await vi.advanceTimersByTimeAsync(0)
      expect(admission.consume).toHaveBeenCalledOnce()
      expect(fetch).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('refuses oversized provider responses without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)))
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
      })
    ).rejects.toThrow('exceeds maximum size')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { timeoutMs: undefined, expectedMs: 29_000 },
    { timeoutMs: 3000, expectedMs: 2000 },
  ])(
    'stops saturated admission at $expectedMs ms when another wait cannot fit',
    async ({ timeoutMs, expectedMs }) => {
      vi.useFakeTimers()
      admission.consume.mockResolvedValue({ allowed: false, retryAfterMs: 1000 })
      const startedAt = Date.now()
      const pending = rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
        timeoutMs,
      })
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'ProviderAdmissionTimeoutError',
      })
      await vi.advanceTimersByTimeAsync(expectedMs)
      await rejected
      expect(Date.now() - startedAt).toBe(expectedMs)
      expect(admission.consume).toHaveBeenCalledTimes(expectedMs / 1000 + 1)
      expect(fetch).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each(
    [
      [
        { index: 0, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.8 },
      ],
      [{ index: 0.5, relevance_score: 0.9 }],
      [{ index: 0, relevance_score: -0.1 }],
      [{ index: 0, relevance_score: 1.1 }],
      [{ index: 0, relevance_score: '0.9' }],
      [{ index: 5, relevance_score: 0.9 }],
      [],
    ].map((results) => ({ results }))
  )(
    'rejects an invalid ranking instead of returning corrupt or missing hits: $results',
    async ({ results }) => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ results }))
      await expect(
        rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each([0, 0.5, 3])('preserves the provider bill of %s search units', async (searchUnits) => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        results: [{ index: 0, relevance_score: 0.9 }],
        meta: { billed_units: { search_units: searchUnits } },
      })
    )
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).resolves.toMatchObject({ billedSearchUnits: searchUnits })
  })

  it.each([
    undefined,
    null,
    { billed_units: null },
    { billed_units: { search_units: null }, warnings: null },
  ])('leaves billing metadata absent for omitted or null provider values: %s', async (meta) => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ results: [{ index: 0, relevance_score: 0.9 }], meta })
    )
    const result = await rerank('query', [{ id: 'one', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      timeoutMs: 3000,
    })
    expect(result.billedSearchUnits).toBeUndefined()
  })

  it('rejects duplicate indices even when the provider returns the requested number of hits', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.8 },
        ],
      })
    )
    await expect(
      rerank(
        'query',
        [
          { id: 'one', text: 'first' },
          { id: 'two', text: 'second' },
        ],
        {
          model: 'rerank-v4.0-fast',
          topN: 2,
        }
      )
    ).rejects.toThrow('incomplete or invalid ranking')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid timeout %s before provider admission',
    async (timeoutMs) => {
      await expect(
        rerank('query', [{ id: 'one', text: 'content' }], {
          model: 'rerank-v4.0-fast',
          timeoutMs,
        })
      ).rejects.toThrow('must be a finite non-negative number')
      expect(admission.consume).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('fails closed before admission when model input provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')
    await expect(
      runWithKnowledgeModelInputProvenance(registry, () =>
        rerank('query', [{ id: 'one', text: 'content' }], {
          model: 'rerank-v4.0-fast',
          timeoutMs: 3000,
        })
      )
    ).rejects.toThrow('Knowledge model input could not be safely projected')
    expect(admission.consume).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shares a 429 pause with another RAG search using the same credential', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
    )
    const first = rerank('first', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.setCooldown).toHaveBeenCalledOnce()
    const second = rerank('second', [{ id: 'two', text: 'content' }], { model: 'rerank-v4.0-fast' })
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(3)
    const reservations = admission.consume.mock.calls.map(
      ([items]) => items[0] as TokenBucketReservation
    )
    expect(new Set(reservations.map((item) => item.key)).size).toBe(1)
    expect(reservations[0].key).toMatch(/^provider:rerank:cohere:[a-f0-9]{64}:requests$/)
    expect(reservations[0].key).not.toContain('cohere-key')
    expect(reservations[0].config.refillRate).toBe(1)
  })

  it('bounds repeated 429s to four attempts with no timer left behind', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation(
      async () => new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
    )
    const pending = rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    const rejected = expect(pending).rejects.toMatchObject({ status: 429 })
    await vi.advanceTimersByTimeAsync(3000)
    await rejected
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(admission.setCooldown).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([undefined, 3000])(
    'does not shorten a 60s provider pause for timeout %s',
    async (timeoutMs) => {
      vi.useFakeTimers()
      const startedAt = Date.now()
      vi.mocked(fetch).mockImplementation(
        async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
      )
      await expect(
        rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast', timeoutMs })
      ).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 })
      await expect(
        rerank('other query', [{ id: 'one', text: 'content' }], {
          model: 'rerank-v4.0-fast',
          timeoutMs,
        })
      ).rejects.toMatchObject({ name: 'ProviderAdmissionTimeoutError' })
      expect([...admission.cooldowns.values()].map((until) => until.getTime())).toEqual([
        startedAt + 60_000,
      ])
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('aborts a request waiting behind another search without a new provider call', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
    )
    const first = rerank('first', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    await vi.advanceTimersByTimeAsync(0)
    const controller = new AbortController()
    const second = rerank('second', [{ id: 'two', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      signal: controller.signal,
    })
    const rejected = expect(second).rejects.toThrow('Second search cancelled')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('Second search cancelled'))
    await rejected
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    await first
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { timeoutMs: undefined, expectedMs: 30_000 },
    { timeoutMs: 3000, expectedMs: 3000 },
  ])(
    'shares a $expectedMs ms deadline across admission, retries and the final response body',
    async ({ timeoutMs, expectedMs }) => {
      vi.useFakeTimers()
      const cancelled = vi.fn()
      admission.consume.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }))
        .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled })))
      const pending = rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
        timeoutMs,
      })
      const rejected = expect(pending).rejects.toThrow(
        'Provider operation exceeded its retry budget'
      )
      await vi.advanceTimersByTimeAsync(999)
      expect(fetch).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(expectedMs - 2000)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(cancelled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(cancelled).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each([429, 503])(
    'bounds repeated %s retries without issuing an attempt at the deadline',
    async (status) => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockImplementation(
        async () =>
          new Response('{}', {
            status,
            headers: { 'Retry-After': '1' },
          })
      )
      const defaultPending = rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
      })
      const defaultRejected = expect(defaultPending).rejects.toMatchObject({ status })
      await vi.advanceTimersByTimeAsync(3000)
      await defaultRejected
      expect(fetch).toHaveBeenCalledTimes(4)
      expect(vi.getTimerCount()).toBe(0)

      admission.cooldowns.clear()
      vi.mocked(fetch).mockClear()
      const interactivePending = rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
        timeoutMs: 3000,
      })
      const interactiveRejected = expect(interactivePending).rejects.toMatchObject({
        name: 'TimeoutError',
      })
      await vi.advanceTimersByTimeAsync(3000)
      await interactiveRejected
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('cancels the shorter budget while sleeping between retries', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', { status: 503, headers: { 'Retry-After': '1' } })
    )
    const controller = new AbortController()
    const pending = rerank('query', [{ id: 'one', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      timeoutMs: 3000,
      signal: controller.signal,
    })
    const rejected = expect(pending).rejects.toThrow('Search cancelled')
    await vi.advanceTimersByTimeAsync(500)
    controller.abort(new Error('Search cancelled'))
    await rejected
    expect(fetch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps unrelated credentials outside another key's cooldown", async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
    )
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).rejects.toMatchObject({ status: 429 })
    env.COHERE_API_KEY = 'separate-cohere-key'
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).resolves.toMatchObject({ results: [{ relevanceScore: 0.9 }] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each(['admission', 'cooldown'] as const)(
    'does not retry provider work when shared %s storage fails',
    async (phase) => {
      vi.useFakeTimers()
      const failure = new Error('Failed query on rate_limit_bucket')
      const cancelled = vi.fn()
      if (phase === 'admission') admission.consume.mockRejectedValue(failure)
      else {
        vi.mocked(fetch).mockImplementation(
          async () => new Response(new ReadableStream({ cancel: cancelled }), { status: 429 })
        )
        admission.setCooldown.mockRejectedValue(failure)
      }
      await expect(
        rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
      ).rejects.toMatchObject({ name: 'ProviderAdmissionStorageError', cause: failure })
      expect(fetch).toHaveBeenCalledTimes(phase === 'admission' ? 0 : 1)
      expect(cancelled).toHaveBeenCalledTimes(phase === 'admission' ? 0 : 1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('retries a transient upstream failure while rejecting an invalid credential immediately', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }))
    const pending = rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ results: [{ relevanceScore: 0.9 }] })
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })
})
