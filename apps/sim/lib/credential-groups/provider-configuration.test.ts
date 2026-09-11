/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const shared = vi.hoisted(() => ({
  env: {
    SLACK_SEARCH_APP_ID: '',
    SLACK_SEARCH_CLIENT_ID: 'environment-client',
    SLACK_SEARCH_CLIENT_SECRET: 'environment-secret',
    SLACK_SEARCH_SIGNING_SECRET: 'environment-signing',
  },
  flag: vi.fn(),
}))
vi.mock('@/lib/core/config/env', () => ({ env: shared.env }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: shared.flag }))

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
  shared.env.SLACK_SEARCH_APP_ID = ''
  shared.flag.mockResolvedValue(true)
})

describe('organization Slack app references', () => {
  it('stores only an app reference and resolves the current app secret for member OAuth', async () => {
    const encryptedProviderConfiguration =
      await encryptCredentialGroupProviderConfiguration(configuration)
    expect(encryptedProviderConfiguration).not.toContain('clientSecret')
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ encryptedProviderConfiguration }])
      .mockResolvedValueOnce([
        {
          id: 'A1',
          clientId: 'client-1',
          encryptedClientSecret: 'encrypted:current-secret',
          encryptedSigningSecret: 'encrypted:signing',
        },
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
  it.each([true, false])(
    'resolves environment credentials only for an active shared installation (active=%s)',
    async (active) => {
      shared.env.SLACK_SEARCH_APP_ID = 'A1'
      dbChainMockFns.limit
        .mockResolvedValueOnce([
          {
            encryptedProviderConfiguration:
              await encryptCredentialGroupProviderConfiguration(configuration),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'A1',
            kind: 'shared',
            organizationId: null,
            clientId: null,
            encryptedClientSecret: null,
            encryptedSigningSecret: null,
          },
        ])
        .mockResolvedValueOnce(active ? [{ id: 'installation' }] : [])
      const result = getSlackCredentialGroupConfiguration({
        organizationId: 'org-1',
        credentialGroupId: 'group-1',
      })
      if (active)
        await expect(result).resolves.toMatchObject({
          clientId: 'environment-client',
          clientSecret: 'environment-secret',
          appId: 'A1',
          teamId: 'T1',
        })
      else await expect(result).rejects.toThrow('disabled or removed')
    }
  )
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
