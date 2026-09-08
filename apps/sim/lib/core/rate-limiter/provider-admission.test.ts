/**
 * @vitest-environment node
 */
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
    getCooldownUntil.mockResolvedValue(null)
    consumeTokens.mockResolvedValue({ allowed: true, tokensRemaining: 1, resetAt: new Date() })
  })

  afterEach(() => vi.useRealTimers())

  it('shares both credential dimensions in one reservation across concurrent callers', async () => {
    await Promise.all([waitForProviderAdmission(INPUT), waitForProviderAdmission(INPUT)])
    expect(consumeTokens).toHaveBeenCalledTimes(2)
    for (const [reservations, options] of consumeTokens.mock.calls) {
      expect(reservations.map((item: { key: string }) => item.key)).toEqual([
        'provider:embedding:openai:hashed-credential:tokens',
        'provider:embedding:openai:hashed-credential:requests',
      ])
      expect(reservations[0].cost).toBe(50)
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
    await expect(waitForProviderAdmission(INPUT)).rejects.toMatchObject({ status: 429 })
    consumeTokens.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(waitForProviderAdmission(INPUT)).rejects.toThrow(
      'Provider admission storage is unavailable'
    )
  })

  it('isolates another credential and does not impose token costs on OCR', async () => {
    await waitForProviderAdmission({
      ...INPUT,
      operation: 'ocr',
      credentialFingerprint: 'another-key',
    })
    expect(consumeTokens).toHaveBeenCalledOnce()
    expect(consumeTokens.mock.calls[0][0]).toMatchObject([
      { key: 'provider:ocr:openai:another-key:requests' },
    ])
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
