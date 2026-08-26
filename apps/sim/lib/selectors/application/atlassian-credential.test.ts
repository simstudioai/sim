/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServiceAccountSecret: vi.fn(),
  providerMatches: vi.fn(),
  refreshToken: vi.fn(),
  resolveAccount: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  getAtlassianServiceAccountSecret: mocks.getServiceAccountSecret,
  refreshAccessTokenIfNeeded: mocks.refreshToken,
  resolveOAuthAccountId: mocks.resolveAccount,
}))
vi.mock('@/lib/selectors/application/credential-provider', () => ({
  selectorCredentialMatchesService: mocks.providerMatches,
}))

import { resolveAtlassianSelectorCredential } from '@/lib/selectors/application/atlassian-credential'

describe('resolveAtlassianSelectorCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.providerMatches.mockResolvedValue(true)
    mocks.resolveAccount.mockResolvedValue({
      providerId: 'atlassian',
      credentialId: 'credential-1',
    })
    mocks.refreshToken.mockResolvedValue('oauth-access-token')
  })

  it('binds a credential to the requested integration before reading or refreshing secrets', async () => {
    mocks.providerMatches.mockResolvedValue(false)

    const result = await resolveAtlassianSelectorCredential({
      credentialId: 'credential-1',
      credentialOwnerUserId: 'owner-1',
      requestId: 'request-1',
      serviceId: 'jira',
    })

    expect(result).toBeNull()
    expect(mocks.providerMatches).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      credentialOwnerUserId: 'owner-1',
      serviceId: 'jira',
    })
    expect(mocks.resolveAccount).not.toHaveBeenCalled()
    expect(mocks.getServiceAccountSecret).not.toHaveBeenCalled()
    expect(mocks.refreshToken).not.toHaveBeenCalled()
  })

  it('refreshes an OAuth token only after provider binding succeeds', async () => {
    const result = await resolveAtlassianSelectorCredential({
      credentialId: 'credential-1',
      credentialOwnerUserId: 'owner-1',
      requestId: 'request-1',
      serviceId: 'confluence',
    })

    expect(result).toEqual({ accessToken: 'oauth-access-token' })
    expect(mocks.refreshToken).toHaveBeenCalledWith('credential-1', 'owner-1', 'request-1')
  })

  it('reads an Atlassian service account only after provider binding succeeds', async () => {
    mocks.resolveAccount.mockResolvedValue({
      providerId: 'atlassian-service-account',
      credentialId: 'service-account-1',
    })
    mocks.getServiceAccountSecret.mockResolvedValue({
      apiToken: 'service-account-token',
      cloudId: 'cloud-1',
    })

    const result = await resolveAtlassianSelectorCredential({
      credentialId: 'credential-1',
      credentialOwnerUserId: 'owner-1',
      requestId: 'request-1',
      serviceId: 'jira',
    })

    expect(result).toEqual({ accessToken: 'service-account-token', cloudId: 'cloud-1' })
    expect(mocks.getServiceAccountSecret).toHaveBeenCalledWith('service-account-1')
    expect(mocks.refreshToken).not.toHaveBeenCalled()
  })
})
