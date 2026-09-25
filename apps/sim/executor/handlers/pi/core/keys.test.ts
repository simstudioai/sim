import { envFlagsMockFns, resetEnvFlagsMock } from '@sim/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  calculateCost: mockCalculateCost,
  shouldBillModelUsage: mockShouldBill,
}))

import {
  computePiCost,
  parsePiSearchProvider,
  resolvePiModelKey,
  resolvePiSearchKey,
} from '@/executor/handlers/pi/core/keys'

beforeAll(() => {
  envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
})

afterAll(resetEnvFlagsMock)

describe('computePiCost', () => {
  it('returns zero cost for BYOK keys without billing', () => {
    expect(computePiCost('claude', 100, 200, true)).toMatchObject({
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
  it('rejects an unrecognized value instead of silently disabling search', () => {
    expect(() => parsePiSearchProvider('Exa')).toThrow(/Invalid Pi search provider/)
    expect(() => parsePiSearchProvider('google')).toThrow(/Invalid Pi search provider/)
    expect(() => parsePiSearchProvider('toString')).toThrow(/Invalid Pi search provider/)
  })
})

describe('resolvePiSearchKey', () => {
  // The field is shown on every deployment, so there is no configuration where a fallback would be
  // needed — and reading one would pull a workspace credential the runner cannot otherwise see into
  // the Create PR sandbox.
  it('never reads a stored workspace BYOK key', () => {
    expect(() => resolvePiSearchKey({ provider: 'serper' })).toThrow(
      /Serper search requires your own Serper API key/
    )
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only key as absent, so no hosted key can be injected later', () => {
    expect(() => resolvePiSearchKey({ provider: 'firecrawl', apiKey: '   ' })).toThrow(
      /Firecrawl search requires your own Firecrawl API key/
    )
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })

  it('never falls back to a Sim-hosted key', () => {
    expect(() => resolvePiSearchKey({ provider: 'exa' })).toThrow(
      /Exa search requires your own Exa API key/
    )
    expect(mockGetApiKeyWithBYOK).not.toHaveBeenCalled()
  })
})
