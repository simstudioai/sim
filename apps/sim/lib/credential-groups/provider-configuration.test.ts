/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: async (value: string) => ({ encrypted: `encrypted:${value}` }),
  decryptSecret: async (value: string) => ({ decrypted: value.replace(/^encrypted:/, '') }),
}))

import {
  decryptCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
  getSlackCredentialGroupConfiguration,
} from '@/lib/credential-groups/provider-configuration'

const configuration = {
  type: 'credential-group-provider-configuration' as const,
  version: 1 as const,
  slack: {
    source: 'slack_app' as const,
    appId: 'A1',
    teamId: 'T1',
    scopes: ['users:read', 'users:read.email'],
    verifiedAt: '2026-09-09T00:00:00.000Z',
  },
}
beforeEach(() => {
  resetDbChainMock()
})

describe('organization Slack app references', () => {
  it('stores only an app reference and resolves the current app secret for member OAuth', async () => {
    const encryptedProviderConfiguration =
      await encryptCredentialGroupProviderConfiguration(configuration)
    expect(encryptedProviderConfiguration).not.toContain('clientSecret')
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ encryptedProviderConfiguration }])
      .mockResolvedValueOnce([
        { id: 'A1', clientId: 'client-1', encryptedClientSecret: 'encrypted:current-secret' },
      ])
    expect(
      await getSlackCredentialGroupConfiguration({
        organizationId: 'org-1',
        credentialGroupId: 'group-1',
      })
    ).toMatchObject({
      appId: 'A1',
      teamId: 'T1',
      clientId: 'client-1',
      clientSecret: 'current-secret',
    })
  })
  it('fails when the referenced app is absent from the owning organization', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          encryptedProviderConfiguration:
            await encryptCredentialGroupProviderConfiguration(configuration),
        },
      ])
      .mockResolvedValueOnce([])
    await expect(
      getSlackCredentialGroupConfiguration({
        organizationId: 'other-org',
        credentialGroupId: 'group-1',
      })
    ).rejects.toThrow('configuration is missing')
  })
  it('rejects a reference that also embeds app secrets', async () => {
    await expect(
      decryptCredentialGroupProviderConfiguration(
        `encrypted:${JSON.stringify({ ...configuration, slack: { ...configuration.slack, clientId: 'client-1', clientSecret: 'must-not-be-stored' } })}`
      )
    ).rejects.toThrow('malformed')
  })
  it('keeps legacy configurations readable until their admin adopts the shared app', async () => {
    const legacy = {
      ...configuration,
      slack: {
        appId: 'A1',
        teamId: 'T1',
        scopes: [],
        verifiedAt: '2026-09-09',
        clientId: 'legacy-client',
        clientSecret: 'legacy-secret',
      },
    }
    dbChainMockFns.limit.mockResolvedValueOnce([
      { encryptedProviderConfiguration: await encryptCredentialGroupProviderConfiguration(legacy) },
    ])
    expect(
      await getSlackCredentialGroupConfiguration({
        organizationId: 'org-1',
        credentialGroupId: 'group-1',
      })
    ).toMatchObject({ clientId: 'legacy-client', clientSecret: 'legacy-secret' })
    expect(dbChainMockFns.limit).toHaveBeenCalledOnce()
  })
})
