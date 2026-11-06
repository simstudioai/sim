import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  liveSearchProviderForCredential,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'

/** Get started's first step: the viewer reads Search through their own connection or a source. */
export function hasSearchIntegrationReady(
  accounts: OrganizationAccountsSettings | undefined,
  policies: SearchIntegrationStatus[] | undefined
): boolean {
  const usable = policies?.filter((policy) => policy.approved && policy.available !== false)
  const approved = new Set(usable?.map((policy) => policy.connectorType))
  const group = accounts?.credentialGroup
  const readyOptions = new Set(
    group?.options
      .filter((option) => {
        const provider = liveSearchProviderForCredential(option.provider)
        return (
          option.status === 'active' &&
          option.configurationStatus === 'ready' &&
          provider &&
          supportsLiveSearchMode(provider, 'member') &&
          approved.has(provider)
        )
      })
      .map((option) => option.id)
  )
  const readyServers = new Set(
    group?.mcpServers
      .filter((server) => {
        const provider = liveSearchProviderForCredential(`mcp:${server.managedConnectorId}`)
        return (
          server.enabled &&
          provider &&
          approved.has(provider) &&
          accounts?.availableMcpConnectors.some((id) => id === server.managedConnectorId)
        )
      })
      .map((server) => server.id)
  )
  const hasConnection =
    group?.status === 'active' &&
    (accounts?.viewerAccounts?.some(
      (account) => account.status === 'active' && readyOptions.has(account.optionId)
    ) ||
      accounts?.viewerMcpAccounts?.some(
        (account) => account.status === 'active' && readyServers.has(account.mcpServerId)
      ))
  return Boolean(hasConnection || usable?.some((policy) => policy.configuredServiceSource))
}
