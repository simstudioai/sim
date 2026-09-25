import { setupGlobalFetchMock } from '@sim/testing/mocks'
import { setEnv } from '@sim/testing/mocks/env.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
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
const { getBYOKKey } = vi.hoisted(() => ({ getBYOKKey: vi.fn() }))
vi.mock('@/lib/api-key/byok', () => ({ getBYOKKey }))
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
    setEnvFlags({ isHosted: true })
    getBYOKKey.mockResolvedValue(null)
    setEnv({
      KB_CONFIG_RERANK_REQUESTS_PER_MINUTE: undefined,
      KB_CONFIG_HOSTED_RERANK_REQUESTS_PER_MINUTE: undefined,
      COHERE_API_KEY_1: undefined,
      COHERE_API_KEY_2: undefined,
      COHERE_API_KEY_3: undefined,
    })
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
    resetEnvFlagsMock()
    vi.unstubAllGlobals()
    for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key]
    Object.assign(env, envSnapshot)
  })

  it('fails before admission when no credential is configured', async () => {
    setEnv({ COHERE_API_KEY: undefined })
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).rejects.toThrow('No Cohere API key configured')
    expect(admission.consume).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
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

  it('refuses oversized provider responses without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)))
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], {
        model: 'rerank-v4.0-fast',
      })
    ).rejects.toThrow('exceeds maximum size')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shares a 429 pause with another RAG search using the same credential', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
    )
    const first = rerank('first', [{ id: 'one', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      workspaceId: 'fixture-workspace-one',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.setCooldown).toHaveBeenCalledOnce()
    const second = rerank('second', [{ id: 'two', text: 'content' }], {
      model: 'rerank-v4.0-fast',
      workspaceId: 'fixture-workspace-two',
    })
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
    expect(reservations[0].config).toMatchObject({ maxTokens: 16, refillRate: 10 })
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

  it('does not shorten a provider pause that exceeds the interactive deadline', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation(
      async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
    )
    await expect(
      rerank('query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 })
    await expect(
      rerank('other query', [{ id: 'one', text: 'content' }], { model: 'rerank-v4.0-fast' })
    ).rejects.toMatchObject({ name: 'ProviderAdmissionTimeoutError' })
    expect(fetch).toHaveBeenCalledTimes(1)
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
