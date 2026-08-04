/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: mockGetRotatingApiKey,
}))

const { mockEnv, mockGetRotatingApiKey, mockGetHostedModels, mockIsHosted } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockGetRotatingApiKey: vi.fn(),
  mockGetHostedModels: vi.fn(() => [] as string[]),
  mockIsHosted: { value: true },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return mockIsHosted.value
  },
}))

vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getHostedModels: mockGetHostedModels,
}))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  PROVIDER_PLACEHOLDER_KEY: 'placeholder',
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: { getState: vi.fn() },
}))

import { getApiKeyWithBYOK, getBYOKKey } from '@/lib/api-key/byok'
import { useProvidersStore } from '@/stores/providers/store'

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

describe('getApiKeyWithBYOK for Fireworks', () => {
  const HOSTED_POOL_MODEL = 'fireworks/glm-5.2'

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsHosted.value = true
    mockEnv.FIREWORKS_API_KEY = 'platform-fireworks-key'
    mockGetHostedModels.mockReturnValue([HOSTED_POOL_MODEL, 'fireworks/kimi-k3'])
    mockGetRotatingApiKey.mockReturnValue('rotated-fireworks-key')
    ;(useProvidersStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      providers: {
        ollama: { models: [] },
        vllm: { models: [] },
        litellm: { models: [] },
        fireworks: { models: [] },
        together: { models: [] },
        baseten: { models: [] },
        'ollama-cloud': { models: [] },
      },
    })
  })

  it('serves the rotating platform key for a hosted catalog model', async () => {
    const result = await getApiKeyWithBYOK('fireworks', HOSTED_POOL_MODEL, uniqueWorkspaceId())

    expect(mockGetRotatingApiKey).toHaveBeenCalledWith('fireworks')
    expect(result).toEqual({ apiKey: 'rotated-fireworks-key', isBYOK: false })
  })

  it('prefers a workspace BYOK key over the platform key, as hosted models do', async () => {
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1')])

    const result = await getApiKeyWithBYOK('fireworks', HOSTED_POOL_MODEL, uniqueWorkspaceId())

    expect(result).toEqual({ apiKey: 'decrypted-key-1', isBYOK: true })
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })

  it('never serves the platform key to a dynamic model on hosted', async () => {
    await expect(
      getApiKeyWithBYOK('fireworks', 'fireworks/accounts/acme/models/custom', uniqueWorkspaceId())
    ).rejects.toThrow('API key is required for Fireworks')
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })

  it('serves a user-provided key for a dynamic model on hosted', async () => {
    const result = await getApiKeyWithBYOK(
      'fireworks',
      'fireworks/accounts/acme/models/custom',
      uniqueWorkspaceId(),
      'user-key'
    )

    expect(result).toEqual({ apiKey: 'user-key', isBYOK: false })
  })

  it('falls back to the env key for any model when self-hosted', async () => {
    mockIsHosted.value = false

    const result = await getApiKeyWithBYOK(
      'fireworks',
      'fireworks/accounts/acme/models/custom',
      uniqueWorkspaceId()
    )

    expect(result).toEqual({ apiKey: 'platform-fireworks-key', isBYOK: false })
  })
})
