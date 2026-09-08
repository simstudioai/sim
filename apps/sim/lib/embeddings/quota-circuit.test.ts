/** @vitest-environment node */
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCooldownUntil, setCooldownUntil } = vi.hoisted(() => ({
  getCooldownUntil: vi.fn(),
  setCooldownUntil: vi.fn(),
}))
vi.mock('@/lib/core/rate-limiter/storage/factory', () => ({
  createStorageAdapter: () => ({ getCooldownUntil, setCooldownUntil }),
}))

import {
  createEmbeddingQuotaCircuitIdentity,
  EMBEDDING_QUOTA_CIRCUIT_TTL_MS,
  isEmbeddingQuotaCircuitOpen,
  openEmbeddingQuotaCircuit,
} from '@/lib/embeddings/quota-circuit'

describe('durable embedding quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCooldownUntil.mockResolvedValue(null)
  })
  it('retains only a credential fingerprint', () => {
    expect(createEmbeddingQuotaCircuitIdentity('openai', 'secret')).toEqual({
      providerId: 'openai',
      credentialFingerprint: sha256Hex('secret'),
    })
  })
  it('uses the same durable backend and absolute expiry as admission', async () => {
    const identity = createEmbeddingQuotaCircuitIdentity('openai', 'secret')
    const now = Date.now()
    await openEmbeddingQuotaCircuit(identity)
    const [key, until] = setCooldownUntil.mock.calls[0]
    expect(key).toBe(`provider:embedding:openai:${identity.credentialFingerprint}:quota`)
    expect(until.getTime()).toBeGreaterThanOrEqual(now + EMBEDDING_QUOTA_CIRCUIT_TTL_MS)
    getCooldownUntil.mockResolvedValue(until)
    expect(await isEmbeddingQuotaCircuitOpen(identity)).toBe(true)
    getCooldownUntil.mockResolvedValue(new Date(now - 1))
    expect(await isEmbeddingQuotaCircuitOpen(identity)).toBe(false)
  })
  it('fails closed on unavailable shared storage rather than restarting a worker burst', async () => {
    getCooldownUntil.mockRejectedValue(new Error('storage unavailable'))
    await expect(
      isEmbeddingQuotaCircuitOpen(createEmbeddingQuotaCircuitIdentity('openai', 'key'))
    ).rejects.toThrow('Provider admission storage is unavailable')
  })
})
