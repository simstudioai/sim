/**
 * @vitest-environment node
 */
import { dbChainMockFns, hasMockCondition, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret, mockIsOrganizationBYOKEntitled } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
  mockIsOrganizationBYOKEntitled: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/api-key/byok-entitlement', () => ({
  isOrganizationBYOKEntitledCached: mockIsOrganizationBYOKEntitled,
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
 * Rotation counters persist for the process lifetime, so each test uses
 * unique workspace and organization ids to start from fresh cursors.
 */
let testIndex = 0
const uniqueWorkspaceId = () => `workspace-${++testIndex}`
const uniqueOrganizationId = () => `organization-${++testIndex}`

const storedKey = (id: string) => ({ id, encryptedApiKey: `encrypted-${id}` })
const storedOrganizationKey = (organizationId: string, id: string) => ({
  organizationId,
  ...storedKey(id),
})

afterAll(resetDbChainMock)

describe('getBYOKKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'decrypted-'),
    }))
    mockIsOrganizationBYOKEntitled.mockResolvedValue(true)
  })

  it('returns null when no workspaceId is provided', async () => {
    expect(await getBYOKKey(undefined, 'openai')).toBeNull()
    expect(await getBYOKKey(null, 'openai')).toBeNull()
  })

  it('returns null when neither the workspace nor its organization has provider keys', async () => {
    expect(await getBYOKKey(uniqueWorkspaceId(), 'openai')).toBeNull()
    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(2)
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('returns the same key on every call when only one key is stored', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1')])

    for (let call = 0; call < 3; call++) {
      expect(await getBYOKKey(workspaceId, 'openai')).toEqual({
        apiKey: 'decrypted-key-1',
        isBYOK: true,
        scope: 'workspace',
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
      scope: 'workspace',
    })
  })

  it('returns null when every key fails to decrypt', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])
    mockDecryptSecret.mockRejectedValue(new Error('corrupt ciphertext'))

    expect(await getBYOKKey(workspaceId, 'openai')).toBeNull()
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('returns null when the keys query throws', async () => {
    dbChainMockFns.orderBy.mockRejectedValue(new Error('database unavailable'))

    expect(await getBYOKKey(uniqueWorkspaceId(), 'openai')).toBeNull()
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('inherits an entitled organization key only after the workspace provider pool is absent', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key-1')])

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })

    expect(dbChainMockFns.innerJoin).toHaveBeenCalledWith(
      schemaMock.organizationBYOKKeys,
      expect.anything()
    )
    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledWith(organizationId)
    expect(mockIsOrganizationBYOKEntitled.mock.invocationCallOrder[0]).toBeLessThan(
      mockDecryptSecret.mock.invocationCallOrder[0]
    )

    const outerWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        outerWhere,
        (node) =>
          node.type === 'eq' && node.left === schemaMock.workspace.id && node.right === workspaceId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        outerWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.organizationBYOKKeys.providerId &&
          node.right === 'openai'
      )
    ).toBe(true)
    expect(hasMockCondition(outerWhere, (node) => node.type === 'notExists')).toBe(true)

    const localOverrideWhere = dbChainMockFns.where.mock.calls.at(-2)?.[0]
    expect(
      hasMockCondition(
        localOverrideWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.workspaceBYOKKeys.workspaceId &&
          node.right === schemaMock.workspace.id
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        localOverrideWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.workspaceBYOKKeys.providerId &&
          node.right === 'openai'
      )
    ).toBe(true)
  })

  it('uses a nonempty workspace pool exclusively without querying organization keys', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('workspace-key')])

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-workspace-key',
      isBYOK: true,
      scope: 'workspace',
    })

    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('keeps provider overrides isolated within the same workspace', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([storedKey('workspace-openai')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-anthropic')])

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-workspace-openai',
      isBYOK: true,
      scope: 'workspace',
    })
    await expect(getBYOKKey(workspaceId, 'anthropic')).resolves.toEqual({
      apiKey: 'decrypted-org-anthropic',
      isBYOK: true,
      scope: 'organization',
    })

    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledTimes(1)
    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledWith(organizationId)
  })

  it('fails closed before decrypting when organization entitlement is false', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key')])
    mockIsOrganizationBYOKEntitled.mockResolvedValue(false)

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toBeNull()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('fails closed before decrypting when organization entitlement throws', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key')])
    mockIsOrganizationBYOKEntitled.mockRejectedValue(new Error('entitlement unavailable'))

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toBeNull()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('does not advance organization rotation while entitlement is denied', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    const organizationPool = [
      storedOrganizationKey(organizationId, 'org-key-1'),
      storedOrganizationKey(organizationId, 'org-key-2'),
    ]
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)
    mockIsOrganizationBYOKEntitled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toBeNull()
    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })
  })

  it('returns null when the organization key query throws', async () => {
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('organization keys unavailable'))

    await expect(getBYOKKey(uniqueWorkspaceId(), 'openai')).resolves.toBeNull()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('returns null when every organization key fails to decrypt', async () => {
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        storedOrganizationKey(organizationId, 'org-key-1'),
        storedOrganizationKey(organizationId, 'org-key-2'),
      ])
    mockDecryptSecret.mockRejectedValue(new Error('corrupt organization ciphertext'))

    await expect(getBYOKKey(uniqueWorkspaceId(), 'openai')).resolves.toBeNull()
    expect(mockDecryptSecret).toHaveBeenCalledTimes(2)
  })

  it('shares organization rotation across member workspaces', async () => {
    const organizationId = uniqueOrganizationId()
    const organizationPool = [
      storedOrganizationKey(organizationId, 'org-key-1'),
      storedOrganizationKey(organizationId, 'org-key-2'),
    ]
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)

    await expect(getBYOKKey(uniqueWorkspaceId(), 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })
    await expect(getBYOKKey(uniqueWorkspaceId(), 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-2',
      isBYOK: true,
      scope: 'organization',
    })
  })

  it('keeps workspace and organization rotation counters in separate namespaces', async () => {
    const sharedId = `shared-${++testIndex}`
    const workspacePool = [storedKey('workspace-key-1'), storedKey('workspace-key-2')]
    const organizationPool = [
      storedOrganizationKey(sharedId, 'org-key-1'),
      storedOrganizationKey(sharedId, 'org-key-2'),
    ]
    dbChainMockFns.orderBy
      .mockResolvedValueOnce(workspacePool)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)

    await expect(getBYOKKey(sharedId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-workspace-key-1',
      isBYOK: true,
      scope: 'workspace',
    })
    await expect(getBYOKKey(uniqueWorkspaceId(), 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })
  })

  it('reads organization key updates fresh on every resolution', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key-before')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key-after')])

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-before',
      isBYOK: true,
      scope: 'organization',
    })
    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key-after',
      isBYOK: true,
      scope: 'organization',
    })

    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledTimes(2)
  })

  it('rechecks the canonical organization attachment and key rows after a delete or detach', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toEqual({
      apiKey: 'decrypted-org-key',
      isBYOK: true,
      scope: 'organization',
    })
    await expect(getBYOKKey(workspaceId, 'openai')).resolves.toBeNull()

    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(4)
    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledTimes(1)
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

    expect(result).toEqual({ apiKey: 'decrypted-key-1', isBYOK: true, scope: 'workspace' })
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
