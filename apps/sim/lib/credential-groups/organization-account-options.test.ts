/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  type OrganizationAccountsSettings,
  updateOrganizationAccountsContract,
} from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import { CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS } from '@/lib/credential-groups/providers'

describe('organization account update options', () => {
  it.each([undefined, '12345678-1234-4123-8123-123456789012'])(
    'satisfies the update contract with stored Slack scopes and bot %s',
    (slackBotCredentialId) => {
      const group: NonNullable<OrganizationAccountsSettings['credentialGroup']> = {
        id: 'group-1',
        workspaceId: null,
        organizationId: 'org-1',
        name: 'Connected accounts',
        description: null,
        mcpServers: [],
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        options: [
          ...CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.map((provider) => ({
            id: `${provider}-option`,
            provider,
            label: provider,
            required: false,
            status: 'active' as const,
            configurationStatus: 'ready' as const,
          })),
          {
            id: 'slack-option',
            provider: 'slack',
            label: 'Slack',
            required: true,
            status: 'active',
            configurationStatus: 'ready',
            slackBotCredentialId,
            requiredScopes: ['search:read', 'channels:history'],
          },
        ],
      }

      const options = getOrganizationAccountUpdateOptions(group)
      const result = updateOrganizationAccountsContract.body.parse({ options })

      expect(result.options).toEqual(options)
      expect(result.options?.map(({ id }) => id)).toEqual(group.options.map(({ id }) => id))
      expect(result.options?.at(-1)).toEqual({
        id: 'slack-option',
        provider: 'slack',
        label: 'Slack',
        required: true,
        slackBotCredentialId,
      })
      expect(group.options.at(-1)).toHaveProperty('requiredScopes', [
        'search:read',
        'channels:history',
      ])
    }
  )
})
