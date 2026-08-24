/**
 * @vitest-environment node
 */
import { sha256Hex } from '@sim/security/hash'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient } = vi.hoisted(() => ({
  mockGetRedisClient: vi.fn(),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import {
  createEmbeddingQuotaCircuitIdentity,
  EMBEDDING_QUOTA_CIRCUIT_TTL_MS,
  isEmbeddingQuotaCircuitOpen,
  openEmbeddingQuotaCircuit,
  resetEmbeddingQuotaCircuitsForTesting,
} from '@/lib/embeddings/quota-circuit'

describe('embedding quota circuit', () => {
  const values = new Map<string, string>()
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
      return 'OK'
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    values.clear()
    resetEmbeddingQuotaCircuitsForTesting()
    mockGetRedisClient.mockReturnValue(redis)
  })

  afterEach(() => {
    resetEmbeddingQuotaCircuitsForTesting()
  })

  it('fingerprints credentials without retaining the secret', () => {
    const identity = createEmbeddingQuotaCircuitIdentity('openai', 'sk-secret')

    expect(identity).toEqual({
      providerId: 'openai',
      credentialFingerprint: sha256Hex('sk-secret'),
    })
    expect(JSON.stringify(identity)).not.toContain('sk-secret')
  })

  it('shares an exhausted credential across workers without extending its expiry', async () => {
    const identity = createEmbeddingQuotaCircuitIdentity('openai', 'sk-shared')
    const openedAt = 1_000_000

    await openEmbeddingQuotaCircuit(identity, openedAt)
    resetEmbeddingQuotaCircuitsForTesting()

    expect(await isEmbeddingQuotaCircuitOpen(identity, openedAt + 1)).toBe(true)
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('embedding-quota-circuit:openai:'),
      String(openedAt + EMBEDDING_QUOTA_CIRCUIT_TTL_MS),
      'PX',
      EMBEDDING_QUOTA_CIRCUIT_TTL_MS
    )
    expect(
      await isEmbeddingQuotaCircuitOpen(identity, openedAt + EMBEDDING_QUOTA_CIRCUIT_TTL_MS + 1)
    ).toBe(false)
  })

  it('isolates different providers and credentials', async () => {
    const exhausted = createEmbeddingQuotaCircuitIdentity('openai', 'sk-exhausted')

    await openEmbeddingQuotaCircuit(exhausted, 1_000_000)

    expect(await isEmbeddingQuotaCircuitOpen(exhausted, 1_000_001)).toBe(true)
    expect(
      await isEmbeddingQuotaCircuitOpen(
        createEmbeddingQuotaCircuitIdentity('openai', 'sk-healthy'),
        1_000_001
      )
    ).toBe(false)
    expect(
      await isEmbeddingQuotaCircuitOpen(
        createEmbeddingQuotaCircuitIdentity('openrouter', 'sk-exhausted'),
        1_000_001
      )
    ).toBe(false)
  })

  it('fails open when Redis is unavailable', async () => {
    mockGetRedisClient.mockImplementation(() => {
      throw new Error('Redis unavailable')
    })

    expect(
      await isEmbeddingQuotaCircuitOpen(
        createEmbeddingQuotaCircuitIdentity('openai', 'sk-test'),
        1_000_000
      )
    ).toBe(false)
  })
})
