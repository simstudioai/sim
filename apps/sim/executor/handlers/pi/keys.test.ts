/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetApiKeyWithBYOK,
  mockGetBYOKKey,
  mockGetProviderFromModel,
  mockCalculateCost,
  mockShouldBill,
  mockResolveVertex,
} = vi.hoisted(() => ({
  mockGetApiKeyWithBYOK: vi.fn(),
  mockGetBYOKKey: vi.fn(),
  mockGetProviderFromModel: vi.fn(),
  mockCalculateCost: vi.fn(),
  mockShouldBill: vi.fn(),
  mockResolveVertex: vi.fn(),
}))

vi.mock('@/lib/api-key/byok', () => ({
  getApiKeyWithBYOK: mockGetApiKeyWithBYOK,
  getBYOKKey: mockGetBYOKKey,
}))
vi.mock('@/providers/utils', () => ({
  getProviderFromModel: mockGetProviderFromModel,
  calculateCost: mockCalculateCost,
  shouldBillModelUsage: mockShouldBill,
}))
vi.mock('@/executor/utils/vertex-credential', () => ({
  resolveVertexCredential: mockResolveVertex,
}))
vi.mock('@/lib/core/config/env-flags', () => ({ getCostMultiplier: () => 2 }))

import { computePiCost, providerApiKeyEnvVar, resolvePiModelKey } from '@/executor/handlers/pi/keys'

describe('providerApiKeyEnvVar', () => {
  it('maps key-based providers and rejects unsupported ones', () => {
    expect(providerApiKeyEnvVar('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(providerApiKeyEnvVar('openai')).toBe('OPENAI_API_KEY')
    expect(providerApiKeyEnvVar('vertex')).toBeNull()
    expect(providerApiKeyEnvVar('bedrock')).toBeNull()
    expect(providerApiKeyEnvVar('something-else')).toBeNull()
  })
})

describe('computePiCost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zero cost for BYOK keys without billing', () => {
    expect(computePiCost('claude', 100, 200, true)).toEqual({ input: 0, output: 0, total: 0 })
    expect(mockCalculateCost).not.toHaveBeenCalled()
  })

  it('returns zero cost for non-billable models', () => {
    mockShouldBill.mockReturnValue(false)
    expect(computePiCost('local-model', 100, 200, false)).toEqual({ input: 0, output: 0, total: 0 })
    expect(mockCalculateCost).not.toHaveBeenCalled()
  })

  it('computes billed cost with the cost multiplier', () => {
    mockShouldBill.mockReturnValue(true)
    mockCalculateCost.mockReturnValue({ input: 1, output: 2, total: 3 })
    expect(computePiCost('claude', 10, 20, false)).toEqual({ input: 1, output: 2, total: 3 })
    expect(mockCalculateCost).toHaveBeenCalledWith('claude', 10, 20, false, 2, 2)
  })
})

describe('resolvePiModelKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves Vertex credentials when the provider is vertex', async () => {
    mockGetProviderFromModel.mockReturnValue('vertex')
    mockResolveVertex.mockResolvedValue('vertex-token')

    const result = await resolvePiModelKey({
      model: 'gemini-pro',
      mode: 'local',
      userId: 'user-1',
      vertexCredential: 'cred-1',
    })

    expect(result).toEqual({ providerId: 'vertex', apiKey: 'vertex-token', isBYOK: true })
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('local mode resolves keys through getApiKeyWithBYOK (hosted keys allowed)', async () => {
    mockGetProviderFromModel.mockReturnValue('anthropic')
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-test', isBYOK: false })

    const result = await resolvePiModelKey({
      model: 'claude',
      mode: 'local',
      workspaceId: 'ws-1',
      apiKey: 'sk-test',
    })

    expect(result).toEqual({ providerId: 'anthropic', apiKey: 'sk-test', isBYOK: false })
    expect(mockGetApiKeyWithBYOK).toHaveBeenCalledWith('anthropic', 'claude', 'ws-1', 'sk-test')
  })

  it('cloud mode uses the block API Key field directly as a BYOK key', async () => {
    mockGetProviderFromModel.mockReturnValue('anthropic')

    const result = await resolvePiModelKey({
      model: 'claude',
      mode: 'cloud',
      workspaceId: 'ws-1',
      apiKey: 'sk-user',
    })

    expect(result).toEqual({ providerId: 'anthropic', apiKey: 'sk-user', isBYOK: true })
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })

  it('cloud mode falls back to a stored workspace key when the field is empty', async () => {
    mockGetProviderFromModel.mockReturnValue('openai')
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'sk-workspace', isBYOK: true })

    const result = await resolvePiModelKey({
      model: 'gpt-5',
      mode: 'cloud',
      workspaceId: 'ws-1',
    })

    expect(result).toEqual({ providerId: 'openai', apiKey: 'sk-workspace', isBYOK: true })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'openai')
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('cloud mode rejects when no user key is available (never a hosted key)', async () => {
    mockGetProviderFromModel.mockReturnValue('anthropic')
    mockGetBYOKKey.mockResolvedValue(null)

    await expect(
      resolvePiModelKey({ model: 'claude', mode: 'cloud', workspaceId: 'ws-1' })
    ).rejects.toThrow(/your own provider API key/)
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('cloud_review mode uses the same BYOK path as cloud', async () => {
    mockGetProviderFromModel.mockReturnValue('anthropic')

    const result = await resolvePiModelKey({
      model: 'claude',
      mode: 'cloud_review',
      workspaceId: 'ws-1',
      apiKey: 'sk-user',
    })

    expect(result).toEqual({ providerId: 'anthropic', apiKey: 'sk-user', isBYOK: true })
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('cloud_review mode rejects when no user key is available', async () => {
    mockGetProviderFromModel.mockReturnValue('anthropic')
    mockGetBYOKKey.mockResolvedValue(null)

    await expect(
      resolvePiModelKey({ model: 'claude', mode: 'cloud_review', workspaceId: 'ws-1' })
    ).rejects.toThrow(/your own provider API key/)
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })
})
