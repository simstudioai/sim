/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: { INTERNAL_API_SECRET: 'shared-internal-secret-at-least-32-chars' },
}))
vi.mock('@/lib/core/execution-limits', () => ({
  getMaxExecutionTimeout: () => 60_000,
}))
vi.mock('@sim/db/schema', () => ({
  piSearchCapabilities: {},
}))

import {
  createPiSearchCapability,
  queryContainsProtectedSecret,
} from '@/lib/pi/exa-search/capabilities'

afterAll(resetDbChainMock)

describe('Pi search capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('stores only hashes and keyed fingerprints, never plaintext secrets', async () => {
    const result = await createPiSearchCapability({
      workspaceId: 'workspace-1',
      providerKeyId: 'exa-key-id',
      executionId: 'execution-1',
      protectedSecrets: ['sk-model-secret', 'ghp_github_secret'],
      extensionFingerprintSecrets: ['ghp_github_secret'],
    })
    const values = dbChainMockFns.values.mock.calls[0][0] as Record<string, unknown>

    expect(result.token).not.toContain('sk-model-secret')
    expect(JSON.stringify(values)).not.toContain('sk-model-secret')
    expect(JSON.stringify(values)).not.toContain('ghp_github_secret')
    expect(values.capabilityHash).not.toBe(result.token)
    expect(result.extensionFingerprints).toHaveLength(1)
  })

  it('detects exact protected material inside a bounded query', async () => {
    await createPiSearchCapability({
      workspaceId: 'workspace-1',
      providerKeyId: 'exa-key-id',
      executionId: 'execution-1',
      protectedSecrets: ['ghp_github_secret'],
    })
    const values = dbChainMockFns.values.mock.calls[0][0] as {
      secretFingerprints: Array<{ length: number; digest: string }>
    }

    expect(
      queryContainsProtectedSecret(
        'please search ghp_github_secret on the web',
        values.secretFingerprints
      )
    ).toBe(true)
    expect(
      queryContainsProtectedSecret('search a normal commit sha', values.secretFingerprints)
    ).toBe(false)
  })
})
