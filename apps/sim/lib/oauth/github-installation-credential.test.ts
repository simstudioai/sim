/** @vitest-environment node */
import { credential } from '@sim/db/schema'
import { inputValidationMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decryptSecret: vi.fn(),
  parseBinding: vi.fn(),
  resolveToken: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decryptSecret }))
vi.mock('@/lib/oauth/github-installation', () => ({
  parseGitHubInstallationBinding: mocks.parseBinding,
  resolveGitHubInstallationAccessToken: mocks.resolveToken,
}))
vi.mock('@/lib/oauth/oauth', () => ({ OAUTH_PROVIDERS: {} }))
vi.mock('@/lib/oauth/refresh-token.server', () => ({ refreshOAuthToken: vi.fn() }))

import { resolveServiceAccountToken } from '@/lib/oauth/credential-service'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const row = {
  type: 'service_account',
  providerId: GITHUB_INSTALLATION_PROVIDER_ID,
  providerSubjectId: '21',
  providerTenantId: '11',
  encryptedServiceAccountKey: 'encrypted',
}
const binding = { installationId: '21', accountId: '11' }

beforeEach(() => {
  resetDbChainMock()
  vi.clearAllMocks()
  mocks.decryptSecret.mockResolvedValue({ decrypted: JSON.stringify(binding) })
  mocks.parseBinding.mockReturnValue(binding)
  mocks.resolveToken.mockResolvedValue({ accessToken: 'ghs_contents' })
})

describe('installation credential token dispatch', () => {
  it('requires a repository scope before reading or decrypting a credential', async () => {
    await expect(
      resolveServiceAccountToken('credential-1', GITHUB_INSTALLATION_PROVIDER_ID)
    ).rejects.toThrow('require a source repository')
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
  })

  it('dispatches only the validated installation credential and exact repository scope', async () => {
    queueTableRows(credential, [row])
    const scope = { repositoryId: '101', repository: 'team/repo' }
    expect(
      await resolveServiceAccountToken(
        'credential-1',
        GITHUB_INSTALLATION_PROVIDER_ID,
        undefined,
        undefined,
        { githubRepositoryScope: scope }
      )
    ).toEqual({ accessToken: 'ghs_contents' })
    expect(mocks.resolveToken).toHaveBeenCalledWith(binding, scope)
  })

  it.each([
    { ...row, type: 'oauth' },
    { ...row, revokedAt: new Date() },
    { ...row, providerId: 'google-service-account' },
    { ...row, encryptedServiceAccountKey: 'x'.repeat(16_385) },
  ])('rejects incompatible or oversized credential rows before decrypting', async (invalidRow) => {
    queueTableRows(credential, [invalidRow])
    await expect(
      resolveServiceAccountToken(
        'credential-1',
        GITHUB_INSTALLATION_PROVIDER_ID,
        undefined,
        undefined,
        { githubRepositoryScope: { repositoryId: '101' } }
      )
    ).rejects.toThrow('unavailable')
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    { ...row, providerSubjectId: '22' },
    { ...row, providerTenantId: '12' },
  ])(
    'refuses a credential whose stored columns disagree with the verified binding',
    async (invalidRow) => {
      queueTableRows(credential, [invalidRow])
      await expect(
        resolveServiceAccountToken(
          'credential-1',
          GITHUB_INSTALLATION_PROVIDER_ID,
          undefined,
          undefined,
          { githubRepositoryScope: { repositoryId: '101' } }
        )
      ).rejects.toThrow('does not match its binding')
      expect(mocks.resolveToken).not.toHaveBeenCalled()
    }
  )
})
