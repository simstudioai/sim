import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { consumeTokens, getCooldownUntil, setCooldownUntil } = vi.hoisted(() => ({
  consumeTokens: vi.fn(),
  getCooldownUntil: vi.fn(),
  setCooldownUntil: vi.fn(),
}))
vi.mock('@/lib/core/rate-limiter/storage/factory', () => ({
  createStorageAdapter: () => ({
    consumeTokensAtomically: consumeTokens,
    getCooldownUntil,
    setCooldownUntil,
  }),
}))

import { waitForProviderAdmission } from '@/lib/core/rate-limiter/provider-admission'
import { DbTokenBucket } from '@/lib/core/rate-limiter/storage/db-token-bucket'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'

const INPUT = {
  providerId: 'openai',
  credentialFingerprint: 'hashed-credential',
  operation: 'embedding' as const,
  inputTokens: 50,
  maxWaitMs: 10_000,
}

describe('provider admission', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({
      KB_CONFIG_RERANK_REQUESTS_PER_MINUTE: undefined,
      KB_CONFIG_HOSTED_RERANK_REQUESTS_PER_MINUTE: undefined,
    })
    getCooldownUntil.mockResolvedValue(null)
    consumeTokens.mockResolvedValue({ allowed: true, tokensRemaining: 1, resetAt: new Date() })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetEnvMock()
  })

  it('shares both credential dimensions in one reservation across concurrent callers', async () => {
    await Promise.all([waitForProviderAdmission(INPUT), waitForProviderAdmission(INPUT)])
    expect(consumeTokens).toHaveBeenCalledTimes(2)
    for (const [reservations, options] of consumeTokens.mock.calls) {
      expect(reservations.map((item: { key: string }) => item.key)).toEqual([
        'provider:embedding:openai:hashed-credential:tokens',
        'provider:embedding:openai:hashed-credential:requests',
      ])
      expect(reservations[0].cost).toBe(50)
      /** Enough burst for every concurrent document to start a batch; the rate still governs throughput. */
      expect(reservations[1].config).toMatchObject({ maxTokens: 64, refillRate: 10 })
      expect(options.cooldownKeys).toHaveLength(2)
    }
  })

  it('waits for shared capacity without consuming another request reservation', async () => {
    consumeTokens.mockResolvedValueOnce({ allowed: false, retryAfterMs: 2000 })
    const pending = waitForProviderAdmission(INPUT)
    await vi.advanceTimersByTimeAsync(1999)
    expect(consumeTokens).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(consumeTokens).toHaveBeenCalledTimes(2)
  })

  it.each([
    { isHostedCredential: true, maxTokens: 16, refillRate: 10 },
    { isHostedCredential: false, maxTokens: 2, refillRate: 1 },
    { isHostedCredential: undefined, maxTokens: 2, refillRate: 1 },
  ])('selects the rerank budget for hosted=$isHostedCredential', async (fixture) => {
    await waitForProviderAdmission({
      ...INPUT,
      operation: 'rerank',
      providerId: 'cohere',
      isHostedCredential: fixture.isHostedCredential,
    })
    expect(consumeTokens.mock.calls[0][0]).toEqual([
      {
        key: 'provider:rerank:cohere:hashed-credential:requests',
        cost: 1,
        config: {
          maxTokens: fixture.maxTokens,
          refillRate: fixture.refillRate,
          refillIntervalMs: 1000,
        },
      },
    ])
  })

  it('preserves the shared override unless a hosted-specific override is set', async () => {
    setEnv({ KB_CONFIG_RERANK_REQUESTS_PER_MINUTE: '120' })
    const input = { ...INPUT, operation: 'rerank' as const, providerId: 'cohere' }
    await waitForProviderAdmission({ ...input, isHostedCredential: true })
    await waitForProviderAdmission(input)
    setEnv({ KB_CONFIG_HOSTED_RERANK_REQUESTS_PER_MINUTE: '300' })
    await waitForProviderAdmission({ ...input, isHostedCredential: true })
    await waitForProviderAdmission(input)
    expect(consumeTokens.mock.calls.map(([reservations]) => reservations[0].config)).toEqual([
      { maxTokens: 16, refillRate: 2, refillIntervalMs: 1000 },
      { maxTokens: 2, refillRate: 2, refillIntervalMs: 1000 },
      { maxTokens: 16, refillRate: 5, refillIntervalMs: 1000 },
      { maxTokens: 2, refillRate: 2, refillIntervalMs: 1000 },
    ])
  })

  it('caps the hosted burst when the configured minute budget is smaller', async () => {
    setEnv({ KB_CONFIG_HOSTED_RERANK_REQUESTS_PER_MINUTE: '1' })
    await waitForProviderAdmission({
      ...INPUT,
      operation: 'rerank',
      providerId: 'cohere',
      isHostedCredential: true,
    })
    expect(consumeTokens.mock.calls[0][0][0].config).toMatchObject({
      maxTokens: 1,
      refillRate: 1 / 60,
    })
  })

  it.each(['0', '-1', '', 'invalid', 'Infinity'])(
    'rejects an invalid hosted rerank override (%s) before spending capacity',
    async (value) => {
      setEnv({ KB_CONFIG_HOSTED_RERANK_REQUESTS_PER_MINUTE: value })
      await expect(
        waitForProviderAdmission({
          ...INPUT,
          operation: 'rerank',
          providerId: 'cohere',
          isHostedCredential: true,
        })
      ).rejects.toThrow('Hosted rerank requests per minute must be finite and at least 1')
      expect(consumeTokens).not.toHaveBeenCalled()
    }
  )

  it.each([
    { operation: 'embedding', providerId: 'openai', maxTokens: 64, refillRate: 10 },
    { operation: 'ocr', providerId: 'mistral', maxTokens: 2, refillRate: 1 },
    { operation: 'rerank', providerId: 'another-provider', maxTokens: 2, refillRate: 1 },
  ] as const)('preserves the $operation budget for $providerId', async (fixture) => {
    setEnv({ KB_CONFIG_HOSTED_RERANK_REQUESTS_PER_MINUTE: '300' })
    await waitForProviderAdmission({
      ...INPUT,
      operation: fixture.operation,
      providerId: fixture.providerId,
      isHostedCredential: true,
    })
    const reservations = consumeTokens.mock.calls[0][0]
    expect(reservations.at(-1).config).toMatchObject({
      maxTokens: fixture.maxTokens,
      refillRate: fixture.refillRate,
    })
  })

  it('sustains 600 hosted reranks per minute through the real bucket refill calculation', async () => {
    const input = {
      ...INPUT,
      operation: 'rerank' as const,
      providerId: 'cohere',
      isHostedCredential: true,
      maxWaitMs: 1,
    }
    let stored: { key: string; tokens: string; lastRefillAt: Date } | undefined
    dbChainMockFns.values.mockImplementation((rows) => {
      stored ??= rows.find((row: { key: string }) => row.key.endsWith(':requests'))
      return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
    })
    dbChainMockFns.limit.mockImplementation(async () => [stored])
    dbChainMockFns.set.mockImplementation((values) => {
      Object.assign(stored!, values)
      return { where: vi.fn().mockResolvedValue(undefined) }
    })
    const bucket = new DbTokenBucket()
    consumeTokens.mockImplementation((reservations, options) =>
      bucket.consumeTokensAtomically(reservations, options)
    )

    for (let request = 0; request < 16; request++) await waitForProviderAdmission(input)
    await expect(waitForProviderAdmission(input)).rejects.toMatchObject({ retryAfterMs: 1000 })
    for (let second = 0; second < 60; second++) {
      await vi.advanceTimersByTimeAsync(1000)
      for (let request = 0; request < 10; request++) await waitForProviderAdmission(input)
      await expect(waitForProviderAdmission(input)).rejects.toMatchObject({ retryAfterMs: 1000 })
    }
    expect(stored?.tokens).toBe('0')
    expect(new Set(consumeTokens.mock.calls.map(([reservations]) => reservations[0].key))).toEqual(
      new Set(['provider:rerank:cohere:hashed-credential:requests'])
    )
  })

  it('stops waiting immediately when the caller aborts', async () => {
    consumeTokens.mockResolvedValue({ allowed: false, retryAfterMs: 5000 })
    const controller = new AbortController()
    const pending = waitForProviderAdmission({ ...INPUT, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('cancelled'))
    await rejected
    expect(consumeTokens).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a wait beyond the caller budget and fails closed on storage errors', async () => {
    consumeTokens.mockResolvedValueOnce({ allowed: false, retryAfterMs: 20_000 })
    await expect(waitForProviderAdmission(INPUT)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 20_000,
    })
    consumeTokens.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(waitForProviderAdmission(INPUT)).rejects.toThrow(
      'Provider admission storage is unavailable'
    )
  })

  it('caps bulk work below the aggregate budget so interactive callers keep headroom', async () => {
    await waitForProviderAdmission({ ...INPUT, bulk: true })
    const [reservations, options] = consumeTokens.mock.calls[0]
    expect(reservations).toMatchObject([
      { key: 'provider:embedding:openai:hashed-credential:tokens', config: { maxTokens: 600_000 } },
      { key: 'provider:embedding:openai:hashed-credential:requests', config: { maxTokens: 64 } },
      {
        key: 'provider:embedding:openai:hashed-credential:bulk:tokens',
        cost: 50,
        config: { maxTokens: 540_000, refillRate: 9_000 },
      },
      {
        key: 'provider:embedding:openai:hashed-credential:bulk:requests',
        config: { maxTokens: 57, refillRate: 9 },
      },
    ])
    expect(options.cooldownKeys).toEqual([
      'provider:embedding:openai:hashed-credential:cooldown',
      'provider:embedding:openai:hashed-credential:quota',
    ])
  })

  it('rejects a bulk batch the lane can never hold and keeps one request slot at a minimal burst', async () => {
    setEnv({
      KB_CONFIG_EMBEDDING_REQUESTS_PER_MINUTE: '1',
      KB_CONFIG_EMBEDDING_TOKENS_PER_MINUTE: '100',
    })
    await expect(
      waitForProviderAdmission({ ...INPUT, inputTokens: 95, bulk: true })
    ).rejects.toThrow('exceeds the configured per-credential token budget')
    await waitForProviderAdmission({ ...INPUT, inputTokens: 95 })
    await waitForProviderAdmission({ ...INPUT, inputTokens: 90, bulk: true })
    expect(consumeTokens.mock.calls[1][0].slice(2)).toMatchObject([
      { key: 'provider:embedding:openai:hashed-credential:bulk:tokens', config: { maxTokens: 90 } },
      {
        key: 'provider:embedding:openai:hashed-credential:bulk:requests',
        config: { maxTokens: 1 },
      },
    ])
  })

  it('isolates another credential and does not impose token costs on OCR', async () => {
    await waitForProviderAdmission({
      ...INPUT,
      operation: 'ocr',
      credentialFingerprint: 'another-key',
    })
    expect(consumeTokens).toHaveBeenCalledOnce()
    expect(consumeTokens.mock.calls[0][0]).toMatchObject([
      { key: 'provider:ocr:openai:another-key:requests', config: { maxTokens: 2 } },
    ])
  })
  it('retains the cooldown when an admission storage call consumes the remaining deadline', async () => {
    consumeTokens.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + INPUT.maxWaitMs)
      return { allowed: false, retryAfterMs: 600_000 }
    })
    await expect(waitForProviderAdmission(INPUT)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 600_000,
    })
    expect(consumeTokens).toHaveBeenCalledOnce()
  })
  it('stops before spending capacity when another worker reported exhausted credit', async () => {
    getCooldownUntil.mockResolvedValue(new Date(Date.now() + 300_000))
    await expect(waitForProviderAdmission(INPUT)).rejects.toMatchObject({ quotaExhausted: true })
    expect(consumeTokens).not.toHaveBeenCalled()
  })

  it('does not spend capacity for an already cancelled or expired operation', async () => {
    await expect(
      waitForProviderAdmission({ ...INPUT, signal: AbortSignal.abort(new Error('cancelled')) })
    ).rejects.toThrow('cancelled')
    await expect(waitForProviderAdmission({ ...INPUT, maxWaitMs: 0 })).rejects.toMatchObject({
      status: 429,
    })
    expect(consumeTokens).not.toHaveBeenCalled()
  })
  it('does not interpret a failed rate_limit_bucket query as a reason to retry provider work', async () => {
    consumeTokens.mockRejectedValue(new Error('rate_limit_bucket database unavailable'))
    const operation = vi.fn(() => waitForProviderAdmission(INPUT))
    await expect(retryWithExponentialBackoff(operation, { maxRetries: 3 })).rejects.toMatchObject({
      retryable: false,
    })
    expect(operation).toHaveBeenCalledOnce()
  })
})
