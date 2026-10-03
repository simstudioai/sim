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
  isEmbeddingQuotaCircuitOpen,
} from '@/lib/embeddings/quota-circuit'

describe('durable embedding quota gate', () => {
  beforeEach(() => {
    getCooldownUntil.mockResolvedValue(null)
  })
  it('retains only a credential fingerprint', () => {
    expect(createEmbeddingQuotaCircuitIdentity('openai', 'secret')).toEqual({
      providerId: 'openai',
      credentialFingerprint: sha256Hex('secret'),
    })
  })
  it('fails closed on unavailable shared storage rather than restarting a worker burst', async () => {
    getCooldownUntil.mockRejectedValue(new Error('storage unavailable'))
    await expect(
      isEmbeddingQuotaCircuitOpen(createEmbeddingQuotaCircuitIdentity('openai', 'key'))
    ).rejects.toThrow('Provider admission storage is unavailable')
  })
})
