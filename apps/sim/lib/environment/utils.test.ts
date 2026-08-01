/**
 * @vitest-environment node
 */
import { dbChainMockFns, encryptionMock, encryptionMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/environment/utils')
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import {
  getEffectiveDecryptedEnv,
  getEffectiveEnvironmentSnapshot,
  invalidateEffectiveDecryptedEnvCache,
} from '@/lib/environment/utils'

describe('effective environment resolution cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    encryptionMockFns.mockDecryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockReset()
    invalidateEffectiveDecryptedEnvCache({ userId: 'user-1' })
    dbChainMockFns.limit.mockResolvedValue([{ variables: { API_KEY: 'encrypted-value' } }])
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'runtime-value' })
  })

  it('shares one atomic snapshot and returns defensive clones', async () => {
    const [decrypted, snapshot] = await Promise.all([
      getEffectiveDecryptedEnv('user-1'),
      getEffectiveEnvironmentSnapshot('user-1'),
    ])

    expect(decrypted).toEqual({ API_KEY: 'runtime-value' })
    expect(snapshot).toMatchObject({
      personalEncrypted: { API_KEY: 'encrypted-value' },
      personalDecrypted: { API_KEY: 'runtime-value' },
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()

    decrypted.API_KEY = 'mutated-runtime'
    snapshot.personalEncrypted.API_KEY = 'mutated-ciphertext'
    snapshot.personalDecrypted.API_KEY = 'mutated-snapshot'
    snapshot.conflicts.push('MUTATED')

    await expect(getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'runtime-value',
    })
    await expect(getEffectiveEnvironmentSnapshot('user-1')).resolves.toMatchObject({
      personalEncrypted: { API_KEY: 'encrypted-value' },
      personalDecrypted: { API_KEY: 'runtime-value' },
      conflicts: [],
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('evicts rejected loads and retries the canonical lookup', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(getEffectiveEnvironmentSnapshot('user-1')).rejects.toThrow('database unavailable')

    dbChainMockFns.limit.mockResolvedValue([{ variables: { API_KEY: 'encrypted-value' } }])
    await expect(getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'runtime-value',
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('reloads the full snapshot after invalidation', async () => {
    await expect(getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'runtime-value',
    })

    invalidateEffectiveDecryptedEnvCache({ userId: 'user-1' })
    dbChainMockFns.limit.mockResolvedValue([{ variables: { API_KEY: 'rotated-ciphertext' } }])
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'rotated-runtime' })

    await expect(getEffectiveEnvironmentSnapshot('user-1')).resolves.toMatchObject({
      personalEncrypted: { API_KEY: 'rotated-ciphertext' },
      personalDecrypted: { API_KEY: 'rotated-runtime' },
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledTimes(2)
  })
})
