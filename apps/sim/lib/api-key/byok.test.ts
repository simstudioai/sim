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
  it('refuses corrupt configured keys in enterprise mode instead of falling back to hosted', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce([storedKey('enterprise-corrupt')])
    mockDecryptSecret.mockRejectedValueOnce(new Error('cannot decrypt'))
    await expect(
      getBYOKKey(uniqueWorkspaceId(), 'anthropic', { failClosed: true })
    ).rejects.toThrow('Configured BYOK credentials are unavailable')
  })

  beforeEach(() => {
    resetDbChainMock()
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'decrypted-'),
    }))
    mockIsOrganizationBYOKEntitled.mockResolvedValue(true)
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

  it.each([
    { label: 'is false', entitle: () => mockIsOrganizationBYOKEntitled.mockResolvedValue(false) },
    {
      label: 'throws',
      entitle: () =>
        mockIsOrganizationBYOKEntitled.mockRejectedValue(new Error('entitlement unavailable')),
    },
  ])('fails closed before decrypting when organization entitlement $label', async ({ entitle }) => {
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(uniqueOrganizationId(), 'org-key')])
    entitle()

    await expect(getBYOKKey(uniqueWorkspaceId(), 'openai')).resolves.toBeNull()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
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
})

describe('getApiKeyWithBYOK provider classification', () => {
  const dynamicProviders = [
    'ollama',
    'vllm',
    'litellm',
    'fireworks',
    'together',
    'baseten',
    'ollama-cloud',
  ] as const

  beforeEach(() => {
    resetDbChainMock()
    mockIsHosted.value = true
    mockEnv.AZURE_OPENAI_API_KEY = 'azure-env-key'
    mockEnv.VLLM_API_KEY = 'vllm-env-key'
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('other-provider-key')])
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'decrypted-'),
    }))
  })

  it('keeps Azure credentials when dynamic discovery contains the same model ID', async () => {
    const model = 'AZURE/CustomDeployment'
    vi.mocked(useProvidersStore.getState).mockReturnValue({
      providers: Object.fromEntries(
        dynamicProviders.map((provider) => [
          provider,
          { models: provider === 'ollama' ? [model] : [] },
        ])
      ),
    } as ReturnType<typeof useProvidersStore.getState>)

    const result = await getApiKeyWithBYOK('azure-openai', model, uniqueWorkspaceId())

    expect(result).toEqual({ apiKey: 'azure-env-key', isBYOK: false })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })

  it.each([['vertex', 'vertex/CustomDeployment', 'vertex-access-token']])(
    'retains caller credentials for %s despite a local model name collision',
    async (provider, model, apiKey) => {
      vi.mocked(useProvidersStore.getState).mockReturnValue({
        providers: Object.fromEntries(dynamicProviders.map((name) => [name, { models: [model] }])),
      } as ReturnType<typeof useProvidersStore.getState>)

      expect(await getApiKeyWithBYOK(provider, model, uniqueWorkspaceId(), apiKey)).toEqual({
        apiKey,
        isBYOK: false,
      })
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['ollama', 'empty'],
    ['vllm', 'vllm-env-key'],
  ])('preserves %s authentication for a custom unprefixed model', async (provider, apiKey) => {
    expect(await getApiKeyWithBYOK(provider, 'MyCustomModel', uniqueWorkspaceId())).toEqual({
      apiKey,
      isBYOK: false,
    })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('uses Bedrock credentials for an uncataloged inference profile', async () => {
    expect(
      await getApiKeyWithBYOK('bedrock', 'BEDROCK/MyInferenceProfile', uniqueWorkspaceId())
    ).toEqual({ apiKey: 'placeholder', isBYOK: false })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})

describe('getApiKeyWithBYOK for TypeSafe', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockIsHosted.value = true
    mockGetHostedModels.mockReturnValue(['jev-latest', 'jev-1.13.0', 'jev-preview'])
    mockGetRotatingApiKey.mockReturnValue('hosted-typesafe-key')
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'decrypted-'),
    }))
    mockIsOrganizationBYOKEntitled.mockResolvedValue(true)
  })

  it.each(['jev-latest'])('resolves the platform pool when %s has no BYOK key', async (model) => {
    await expect(getApiKeyWithBYOK('typesafe', model, uniqueWorkspaceId())).resolves.toEqual({
      apiKey: 'hosted-typesafe-key',
      isBYOK: false,
    })
    expect(mockGetRotatingApiKey).toHaveBeenCalledWith('typesafe')
  })

  it('inherits an entitled organization pool before using hosted credits', async () => {
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(uniqueOrganizationId(), 'organization-key')])
    await expect(getApiKeyWithBYOK('typesafe', 'jev-latest', uniqueWorkspaceId())).resolves.toEqual(
      {
        apiKey: 'decrypted-organization-key',
        isBYOK: true,
        scope: 'organization',
      }
    )
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })

  it('rejects missing hosted credentials instead of making an unauthenticated request', async () => {
    mockGetRotatingApiKey.mockImplementation(() => {
      throw new Error('No configured key')
    })
    await expect(getApiKeyWithBYOK('typesafe', 'jev-latest', uniqueWorkspaceId())).rejects.toThrow(
      'No API key available for typesafe jev-latest'
    )
  })

  it('never gives the hosted key to an unlisted model', async () => {
    await expect(getApiKeyWithBYOK('typesafe', 'jev-custom', uniqueWorkspaceId())).rejects.toThrow(
      'API key is required'
    )
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })

  it('requires caller credentials on self-hosted deployments', async () => {
    mockIsHosted.value = false
    await expect(
      getApiKeyWithBYOK('typesafe', 'jev-latest', uniqueWorkspaceId(), 'caller-key')
    ).resolves.toEqual({ apiKey: 'caller-key', isBYOK: false })
    await expect(getApiKeyWithBYOK('typesafe', 'jev-latest', uniqueWorkspaceId())).rejects.toThrow(
      'API key is required'
    )
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })
})

describe('getApiKeyWithBYOK for Fireworks', () => {
  const HOSTED_POOL_MODEL = 'fireworks/glm-5.2'

  beforeEach(() => {
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
