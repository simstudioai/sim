/**
 * @vitest-environment node
 */
import { envFlagsMockFns, resetEnvFlagsMock } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetApiKeyWithBYOK, mockGetBYOKKey, mockCalculateCost, mockShouldBill } = vi.hoisted(
  () => ({
    mockGetApiKeyWithBYOK: vi.fn(),
    mockGetBYOKKey: vi.fn(),
    mockCalculateCost: vi.fn(),
    mockShouldBill: vi.fn(),
  })
)

vi.mock('@/lib/api-key/byok', () => ({
  getApiKeyWithBYOK: mockGetApiKeyWithBYOK,
  getBYOKKey: mockGetBYOKKey,
}))
vi.mock('@/providers/utils', () => ({
  calculateCost: mockCalculateCost,
  shouldBillModelUsage: mockShouldBill,
}))

import {
  computePiCost,
  parsePiSearchProvider,
  providerApiKeyEnvVar,
  resolvePiModelKey,
  resolvePiSearchKey,
} from '@/executor/handlers/pi/keys'

beforeAll(() => {
  envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
})

afterAll(resetEnvFlagsMock)

describe('providerApiKeyEnvVar', () => {
  it('maps key-based providers and rejects unsupported ones', () => {
    expect(providerApiKeyEnvVar('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(providerApiKeyEnvVar('openai')).toBe('OPENAI_API_KEY')
    expect(providerApiKeyEnvVar('fireworks')).toBe('FIREWORKS_API_KEY')
    expect(providerApiKeyEnvVar('together')).toBe('TOGETHER_API_KEY')
    expect(providerApiKeyEnvVar('nvidia')).toBe('NVIDIA_API_KEY')
    expect(providerApiKeyEnvVar('zai')).toBe('ZAI_API_KEY')
    expect(providerApiKeyEnvVar('kimi')).toBe('MOONSHOT_API_KEY')
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
    expect(computePiCost('claude', 100, 200, true)).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
    })
    expect(mockCalculateCost).not.toHaveBeenCalled()
  })

  it('returns zero cost for non-billable models', () => {
    mockShouldBill.mockReturnValue(false)
    expect(computePiCost('local-model', 100, 200, false)).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
    })
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

  it('Local Dev preserves a direct user key as BYOK', async () => {
    const result = await resolvePiModelKey({
      providerId: 'anthropic',
      model: 'claude',
      mode: 'local',
      workspaceId: 'ws-1',
      apiKey: 'sk-user',
    })

    expect(result).toEqual({ apiKey: 'sk-user', isBYOK: true })
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('Local Dev can use a hosted key because the model runs in Sim', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-hosted', isBYOK: false })

    await expect(
      resolvePiModelKey({
        providerId: 'anthropic',
        model: 'claude',
        mode: 'local',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ apiKey: 'sk-hosted', isBYOK: false })
    expect(mockGetApiKeyWithBYOK).toHaveBeenCalledWith('anthropic', 'claude', 'ws-1', undefined)
  })

  it('Create PR uses the block API Key field directly as a BYOK key', async () => {
    const result = await resolvePiModelKey({
      providerId: 'anthropic',
      model: 'claude',
      mode: 'cloud',
      workspaceId: 'ws-1',
      apiKey: 'sk-user',
    })

    expect(result).toEqual({ apiKey: 'sk-user', isBYOK: true })
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })

  it('Create PR falls back to a stored workspace key when the field is empty', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'sk-workspace', isBYOK: true })

    const result = await resolvePiModelKey({
      providerId: 'openai',
      model: 'gpt-5',
      mode: 'cloud',
      workspaceId: 'ws-1',
    })

    expect(result).toEqual({ apiKey: 'sk-workspace', isBYOK: true })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'openai')
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('Create PR supports a stored xAI workspace key', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'xai-workspace-key', isBYOK: true })

    await expect(
      resolvePiModelKey({
        providerId: 'xai',
        model: 'grok-4.5',
        mode: 'cloud',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ apiKey: 'xai-workspace-key', isBYOK: true })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'xai')
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('Create PR supports stored workspace keys for newly mapped providers', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'fireworks-workspace-key', isBYOK: true })

    await expect(
      resolvePiModelKey({
        providerId: 'fireworks',
        model: 'fireworks/accounts/fireworks/models/gpt-oss-120b',
        mode: 'cloud',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ apiKey: 'fireworks-workspace-key', isBYOK: true })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'fireworks')
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('Create PR rejects when no user key is available (never a hosted key)', async () => {
    mockGetBYOKKey.mockResolvedValue(null)

    await expect(
      resolvePiModelKey({
        providerId: 'anthropic',
        model: 'claude',
        mode: 'cloud',
        workspaceId: 'ws-1',
      })
    ).rejects.toThrow(/your own provider API key/)
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('Babysit has the same BYOK-only key boundary as Create PR', async () => {
    mockGetBYOKKey.mockResolvedValueOnce({ apiKey: 'sk-workspace', isBYOK: true })
    await expect(
      resolvePiModelKey({
        providerId: 'anthropic',
        model: 'claude',
        mode: 'babysit',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ apiKey: 'sk-workspace', isBYOK: true })

    mockGetBYOKKey.mockResolvedValueOnce(null)
    await expect(
      resolvePiModelKey({
        providerId: 'anthropic',
        model: 'claude',
        mode: 'babysit',
        workspaceId: 'ws-1',
      })
    ).rejects.toThrow(/Babysit requires your own provider API key/)
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('cloud_review mode preserves a direct user key as BYOK', async () => {
    const result = await resolvePiModelKey({
      providerId: 'anthropic',
      model: 'claude',
      mode: 'cloud_review',
      workspaceId: 'ws-1',
      apiKey: 'sk-user',
    })

    expect(result).toEqual({ apiKey: 'sk-user', isBYOK: true })
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('cloud_review mode can use a hosted key because the model runs in Sim', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-hosted', isBYOK: false })

    await expect(
      resolvePiModelKey({
        providerId: 'anthropic',
        model: 'claude',
        mode: 'cloud_review',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ apiKey: 'sk-hosted', isBYOK: false })
    expect(mockGetApiKeyWithBYOK).toHaveBeenCalledWith('anthropic', 'claude', 'ws-1', undefined)
  })
})

describe('parsePiSearchProvider', () => {
  it('treats an absent value as none so blocks saved before the field keep running', () => {
    expect(parsePiSearchProvider(undefined)).toBe('none')
    expect(parsePiSearchProvider(null)).toBe('none')
    expect(parsePiSearchProvider('')).toBe('none')
    expect(parsePiSearchProvider('   ')).toBe('none')
    expect(parsePiSearchProvider('none')).toBe('none')
  })

  it('accepts every offered provider', () => {
    expect(parsePiSearchProvider('exa')).toBe('exa')
    expect(parsePiSearchProvider('serper')).toBe('serper')
    expect(parsePiSearchProvider('parallel')).toBe('parallel')
    expect(parsePiSearchProvider('firecrawl')).toBe('firecrawl')
    expect(parsePiSearchProvider(' exa ')).toBe('exa')
  })

  it('rejects an unrecognized value instead of silently disabling search', () => {
    expect(() => parsePiSearchProvider('Exa')).toThrow(/Invalid Pi search provider/)
    expect(() => parsePiSearchProvider('google')).toThrow(/Invalid Pi search provider/)
    expect(() => parsePiSearchProvider('toString')).toThrow(/Invalid Pi search provider/)
  })
})

describe('resolvePiSearchKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers the block field and reports its source', async () => {
    await expect(
      resolvePiSearchKey({ provider: 'exa', workspaceId: 'ws-1', apiKey: 'exa-field' })
    ).resolves.toEqual({ apiKey: 'exa-field', source: 'block' })
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })

  it('falls back to the stored workspace key for the selected provider', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'serper-stored', isBYOK: true })

    await expect(resolvePiSearchKey({ provider: 'serper', workspaceId: 'ws-1' })).resolves.toEqual({
      apiKey: 'serper-stored',
      source: 'byok',
    })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'serper')
  })

  it('maps Parallel to its BYOK provider id', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'parallel-stored', isBYOK: true })

    await resolvePiSearchKey({ provider: 'parallel', workspaceId: 'ws-1' })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'parallel_ai')
  })

  it('treats a whitespace-only key as absent, so no hosted key can be injected later', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: '  firecrawl-stored  ', isBYOK: true })

    await expect(
      resolvePiSearchKey({ provider: 'firecrawl', workspaceId: 'ws-1', apiKey: '   ' })
    ).resolves.toEqual({ apiKey: 'firecrawl-stored', source: 'byok' })
    expect(mockGetBYOKKey).toHaveBeenCalledWith('ws-1', 'firecrawl')
  })

  it('never falls back to a Sim-hosted key', async () => {
    mockGetBYOKKey.mockResolvedValue(null)

    await expect(resolvePiSearchKey({ provider: 'exa', workspaceId: 'ws-1' })).rejects.toThrow(
      /Exa search requires your own Exa API key/
    )
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })

  it('reports a blank stored key as missing rather than passing it on', async () => {
    mockGetBYOKKey.mockResolvedValue({ apiKey: '   ', isBYOK: true })

    await expect(resolvePiSearchKey({ provider: 'serper', workspaceId: 'ws-1' })).rejects.toThrow(
      /Serper search requires your own Serper API key/
    )
  })
})
