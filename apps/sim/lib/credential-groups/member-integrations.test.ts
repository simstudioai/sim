/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { memberIntegrationEntries } from '@/lib/credential-groups/member-integrations'

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
const settings = (viewerAccounts: unknown[], viewerMcpAccounts: unknown[] = []) =>
  ({
    credentialGroup: {
      status: 'active',
      options: [option('drive', 'google-drive')],
      mcpServers: [
        { id: 'notion-server', managedConnectorId: 'notion', enabled: true },
        { id: 'lucid-server', managedConnectorId: 'lucid', enabled: true },
      ],
    },
    assistantProviders: [],
    availableProviders: ['google-drive'],
    availableMcpConnectors: [],
    viewerAccounts,
    viewerMcpAccounts,
  }) as unknown as OrganizationAccountsSettings

const approved = (connectorType: string) =>
  ({ connectorType, approved: true, available: true }) as SearchIntegrationStatus

function entryFor(provider: string, viewerAccounts: unknown[], viewerMcpAccounts: unknown[] = []) {
  return memberIntegrationEntries(settings(viewerAccounts, viewerMcpAccounts), [
    approved('google_drive'),
    approved('notion'),
    approved('lucid'),
  ]).find((entry) => entry.provider === provider)
}

describe('offering another account', () => {
  it.each(['jama', 'flow'] as const)(
    'keeps %s reconnects available but stops offering another account at the limit',
    (provider) => {
      const providerId = `${provider}-service-account` as const
      const accounts = Array.from({ length: 5 }, (_, index) => ({
        credentialId: `${provider}-${index}`,
        displayName: `account-${index}@example.test`,
        providerId,
        status: 'active' as const,
      }))
      const project = (viewerSavedAccounts: typeof accounts) =>
        memberIntegrationEntries({ ...settings([]), viewerSavedAccounts }, [
          approved(provider),
        ]).find((entry) => entry.provider === provider)

      expect(project(accounts.slice(0, 4))?.connectionTarget).toEqual({
        savedProviderId: providerId,
      })
      const full = project(accounts)
      expect(full?.connectionTarget).toBeUndefined()
      expect(full?.reconnectAccountIds).toEqual(accounts.map((entry) => entry.credentialId))
    }
  )

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

  const mcpAccount = (index: number, mcpServerId: string) => ({
    credentialId: `mcp-cg-${mcpServerId}-${index}`,
    displayName: `account-${index}`,
    mcpServerId,
    status: 'active',
  })

  it('offers another managed MCP account when the connector can identify accounts', () => {
    expect(entryFor('notion', [], [mcpAccount(1, 'notion-server')])).toMatchObject({
      connectionTarget: { mcpServerId: 'notion-server' },
    })
  })

  it('stops offering a managed MCP account at the limit', () => {
    const accounts = Array.from({ length: 5 }, (_, index) => mcpAccount(index, 'notion-server'))
    expect(entryFor('notion', [], accounts)?.connectionTarget).toBeUndefined()
  })

  it('offers one account for a connector that cannot identify accounts', () => {
    expect(entryFor('lucid', [])?.connectionTarget).toEqual({ mcpServerId: 'lucid-server' })
    expect(entryFor('lucid', [], [mcpAccount(1, 'lucid-server')])?.connectionTarget).toBeUndefined()
  })
})
