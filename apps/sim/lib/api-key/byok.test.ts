/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
}))

vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getHostedModels: vi.fn(() => []),
}))

vi.mock('@/providers/utils', () => ({
  PROVIDER_PLACEHOLDER_KEY: 'placeholder',
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: { getState: vi.fn() },
}))

import { getBYOKKey } from '@/lib/api-key/byok'

/**
 * Rotation counters in the module under test are keyed by
 * `${workspaceId}:${providerId}` and persist for the process lifetime, so
 * each test uses a unique workspace id to start from a fresh cursor.
 */
let testIndex = 0
const uniqueWorkspaceId = () => `workspace-${++testIndex}`

const storedKey = (id: string) => ({ id, encryptedApiKey: `encrypted-${id}` })

afterAll(resetDbChainMock)

describe('getBYOKKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'decrypted-'),
    }))
  })

  it('returns null when no workspaceId is provided', async () => {
    expect(await getBYOKKey(undefined, 'openai')).toBeNull()
    expect(await getBYOKKey(null, 'openai')).toBeNull()
  })

  it('returns null when the workspace has no keys for the provider', async () => {
    expect(await getBYOKKey(uniqueWorkspaceId(), 'openai')).toBeNull()
  })

  it('returns the same key on every call when only one key is stored', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1')])

    for (let call = 0; call < 3; call++) {
      expect(await getBYOKKey(workspaceId, 'openai')).toEqual({
        apiKey: 'decrypted-key-1',
        isBYOK: true,
      })
    }
  })

  it('round-robins across multiple keys in creation order', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([
      storedKey('key-1'),
      storedKey('key-2'),
      storedKey('key-3'),
    ])

    const apiKeys = []
    for (let call = 0; call < 4; call++) {
      const result = await getBYOKKey(workspaceId, 'openai')
      apiKeys.push(result?.apiKey)
    }

    expect(apiKeys).toEqual([
      'decrypted-key-1',
      'decrypted-key-2',
      'decrypted-key-3',
      'decrypted-key-1',
    ])
  })

  it('reads the key list fresh from the database on every call', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1')])

    await getBYOKKey(workspaceId, 'openai')
    await getBYOKKey(workspaceId, 'openai')
    await getBYOKKey(workspaceId, 'openai')

    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(3)
  })

  it('tracks rotation independently per provider within a workspace', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])

    expect((await getBYOKKey(workspaceId, 'openai'))?.apiKey).toBe('decrypted-key-1')
    expect((await getBYOKKey(workspaceId, 'anthropic'))?.apiKey).toBe('decrypted-key-1')
    expect((await getBYOKKey(workspaceId, 'openai'))?.apiKey).toBe('decrypted-key-2')
  })

  it('skips a key that fails to decrypt and returns the next one', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])
    mockDecryptSecret.mockImplementation(async (encrypted: string) => {
      if (encrypted === 'encrypted-key-1') {
        throw new Error('corrupt ciphertext')
      }
      return { decrypted: encrypted.replace('encrypted-', 'decrypted-') }
    })

    expect(await getBYOKKey(workspaceId, 'openai')).toEqual({
      apiKey: 'decrypted-key-2',
      isBYOK: true,
    })
  })

  it('returns null when every key fails to decrypt', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])
    mockDecryptSecret.mockRejectedValue(new Error('corrupt ciphertext'))

    expect(await getBYOKKey(workspaceId, 'openai')).toBeNull()
  })

  it('returns null when the keys query throws', async () => {
    dbChainMockFns.orderBy.mockRejectedValue(new Error('database unavailable'))

    expect(await getBYOKKey(uniqueWorkspaceId(), 'openai')).toBeNull()
  })
})
