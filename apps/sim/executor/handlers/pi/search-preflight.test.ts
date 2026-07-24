/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveByok, mockFlag, mockWorkspace } = vi.hoisted(() => ({
  mockResolveByok: vi.fn(),
  mockFlag: vi.fn(),
  mockWorkspace: vi.fn(),
}))

vi.mock('@/lib/api-key/byok', () => ({ resolveBYOKKey: mockResolveByok }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabledStrict: mockFlag }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockWorkspace,
}))
vi.mock('@/lib/core/config/env', () => ({
  env: {
    PI_EXA_BROKER_BASE_URL: 'https://sim.example.com',
    INTERNAL_API_SECRET: 'internal-secret-at-least-32-characters',
  },
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isProd: true }))

import { preflightPiSearch } from '@/executor/handlers/pi/search-preflight'

describe('Pi search preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspace.mockResolvedValue({ organizationId: 'org-1' })
    mockFlag.mockResolvedValue({ enabled: true, source: 'appconfig' })
    mockResolveByok.mockResolvedValue({
      status: 'found',
      value: { apiKey: 'exa-key', isBYOK: true, keyId: 'exa-key-id' },
    })
  })

  it('requires workspace Exa BYOK with a clear setup message', async () => {
    mockResolveByok.mockResolvedValue({ status: 'missing' })
    await expect(
      preflightPiSearch({ workspaceId: 'ws', executionId: 'exec', userId: 'user' })
    ).rejects.toThrow(/Settings > BYOK > Exa/)
  })

  it('does not treat infrastructure failures as a missing key', async () => {
    mockResolveByok.mockResolvedValue({
      status: 'infrastructure_error',
      error: new Error('database unavailable'),
    })
    await expect(
      preflightPiSearch({ workspaceId: 'ws', executionId: 'exec', userId: 'user' })
    ).rejects.toThrow(/Unable to load/)
  })

  it('returns a canonical HTTPS broker origin', async () => {
    await expect(
      preflightPiSearch({ workspaceId: 'ws', executionId: 'exec', userId: 'user' })
    ).resolves.toEqual({
      brokerBaseUrl: 'https://sim.example.com',
      workspaceId: 'ws',
      executionId: 'exec',
      exaApiKey: 'exa-key',
      exaKeyId: 'exa-key-id',
    })
    expect(mockFlag).toHaveBeenCalledWith('pi-create-pr-search', {
      userId: 'user',
      orgId: 'org-1',
    })
  })
})
