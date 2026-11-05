/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { memberIntegrationEntries } from '@/lib/credential-groups/member-integrations'
import { SLACK_SEARCH_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'

function option(id: string, provider: string, requiredScopes: readonly string[] = []) {
  return {
    id,
    provider,
    label: provider,
    required: false,
    status: 'active',
    configurationStatus: 'ready',
    requiredScopes: [...requiredScopes],
  }
}

const account = (index: number, optionId: string, providerId: string) => ({
  credentialId: `credential-${optionId}-${index}`,
  displayName: `account-${index}@example.test`,
  optionId,
  providerId,
  status: 'active',
})

// double-cast-allowed: the fixture holds only the fields this projection reads
const settings = (viewerAccounts: unknown[]) =>
  ({
    credentialGroup: {
      status: 'active',
      options: [
        option('drive', 'google-drive'),
        option('slack', 'slack', SLACK_SEARCH_USER_SCOPES),
      ],
      mcpServers: [],
    },
    assistantProviders: [],
    availableProviders: ['google-drive', 'slack'],
    availableMcpConnectors: [],
    viewerAccounts,
    viewerMcpAccounts: [],
  }) as unknown as OrganizationAccountsSettings

const approved = (connectorType: string) =>
  ({ connectorType, approved: true, available: true }) as SearchIntegrationStatus

function entryFor(provider: string, viewerAccounts: unknown[]) {
  return memberIntegrationEntries(settings(viewerAccounts), [
    approved('google_drive'),
    approved('slack'),
  ]).find((entry) => entry.provider === provider)
}

describe('offering another account', () => {
  it('still offers the provider to a member who has connected one account', () => {
    expect(entryFor('google_drive', [account(1, 'drive', 'google-drive')])).toMatchObject({
      connectionTarget: { optionId: 'drive' },
    })
  })

  it('stops offering it at the per-provider limit', () => {
    const accounts = Array.from({ length: 5 }, (_, index) =>
      account(index, 'drive', 'google-drive')
    )
    expect(entryFor('google_drive', accounts)?.connectionTarget).toBeUndefined()
  })

  it('applies the same rule to Slack', () => {
    expect(entryFor('slack', [account(1, 'slack', 'slack')])?.connectionTarget).toEqual({
      optionId: 'slack',
    })
  })
})
