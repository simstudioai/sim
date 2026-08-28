/**
 * @vitest-environment node
 */

import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeCredentialUse: vi.fn(),
  credentialProviderMatchesService: vi.fn(),
  getServiceConfig: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorizeCredentialUse,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialAccessToken: vi.fn(),
}))

vi.mock('@/lib/oauth/utils', () => ({
  credentialProviderMatchesService: mocks.credentialProviderMatchesService,
  getServiceConfigByServiceId: mocks.getServiceConfig,
}))

import { authorizeSelectorCredential } from '@/lib/selectors/server/credentials'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const policy = {
  kind: 'stored' as const,
  field: 'oauthCredential' as const,
  serviceIds: ['gmail'],
}

function authorize(): Promise<unknown> {
  return authorizeSelectorCredential({
    principal,
    context: { oauthCredential: 'credential-1' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    policy,
    protectedValues: createSelectorProtectedValues(),
  })
}

describe('authorizeSelectorCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getServiceConfig.mockReturnValue({ id: 'gmail' })
  })

  it('conceals a credential authorized in a different workspace', async () => {
    mocks.authorizeCredentialUse.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-2',
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'credential-1',
    })

    await expect(authorize()).rejects.toEqual(new SelectorConnectionUnavailableError())
    expect(mocks.credentialProviderMatchesService).not.toHaveBeenCalled()
  })

  it('conceals a stored credential whose trusted provider does not match the selector service', async () => {
    mocks.authorizeCredentialUse.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-1',
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'credential-1',
    })
    queueTableRows(credential, [{ accountId: 'account-1', providerId: 'microsoft' }])
    mocks.credentialProviderMatchesService.mockReturnValue(false)

    await expect(authorize()).rejects.toEqual(new SelectorConnectionUnavailableError())
    expect(mocks.credentialProviderMatchesService).toHaveBeenCalledWith('microsoft', {
      id: 'gmail',
    })
  })
})
