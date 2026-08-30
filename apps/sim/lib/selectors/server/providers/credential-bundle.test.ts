/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockResolveCredentialAccessToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialAccessToken: mockResolveCredentialAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'

describe('selector credential bundles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('protects short credential-bound cloud ids as exact identifiers', async () => {
    mockResolveCredentialAccessToken.mockResolvedValue({
      accessToken: 'server-only-token',
      cloudId: 'cloud-1',
      domain: 'acme.atlassian.net',
    })
    const protectedValues = createSelectorProtectedValues()

    await expect(
      resolveSelectorCredentialBundle({
        credential: {
          suppliedId: 'credential-1',
          access: { ok: true, credentialOwnerUserId: 'owner-1' },
        },
        protectedValues,
      })
    ).resolves.toMatchObject({ cloudId: 'cloud-1' })

    expect(protectedValues.contains('cloud-1')).toBe(true)
    expect(protectedValues.contains('prefix-cloud-1-suffix')).toBe(false)
  })
})
