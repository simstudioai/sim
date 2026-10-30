import type { ComponentType } from 'react'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import {
  findCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { hasSlackSearchUserScopes } from '@/lib/credential-groups/slack-managed-user-scopes'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'
import {
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
} from '@/lib/sim-search/live/source-catalog'

const SEARCH_ACCOUNT_PROVIDERS = new Set([
  'slack',
  ...LIVE_SEARCH_SOURCE_TYPES.flatMap(([source]) => {
    const provider = liveSearchMemberAccountProvider(source)
    return provider ? [provider] : []
  }),
])

export function assistantAccountOptions(data: OrganizationAccountsSettings, search: string) {
  const providers = data.assistantProviders.filter(
    (provider) => !SEARCH_ACCOUNT_PROVIDERS.has(provider)
  )
  const ownedOptions = new Set(data.viewerAccounts?.map((account) => account.optionId))
  const configured =
    data.credentialGroup?.options.filter(
      (option) =>
        !SEARCH_ACCOUNT_PROVIDERS.has(option.provider) &&
        ((option.status === 'active' && providers.includes(option.provider)) ||
          ownedOptions.has(option.id))
    ) ?? []
  const query = search.trim().toLowerCase()
  const visible = configured.filter((option) =>
    [
      getCredentialGroupProviderService(option.provider).name,
      ...(data.viewerAccounts ?? [])
        .filter((account) => account.optionId === option.id)
        .map((account) => account.displayName),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
  return { providers, configured, visible }
}

export interface MemberIntegration {
  id: string
  provider: string
  name: string
  icon: ComponentType<{ className?: string }>
  accounts: MemberIntegrationAccount[]
  permissionAccountIds: string[]
  reconnectAccountIds: string[]
  connectionTarget?: { optionId: string } | { mcpServerId: string }
  ready: boolean
  managed?: boolean
  description?: string
}

type MemberIntegrationAccount =
  | NonNullable<OrganizationAccountsSettings['viewerAccounts']>[number]
  | NonNullable<OrganizationAccountsSettings['viewerMcpAccounts']>[number]

/** One member inventory, preserving native grant and managed MCP server identities. */
export function memberIntegrationEntries(
  data: OrganizationAccountsSettings,
  policies: SearchIntegrationStatus[] | undefined
): MemberIntegration[] {
  const group = data.credentialGroup
  const approvals = new Map(policies?.map((policy) => [policy.connectorType, policy]))
  const permissionIds = new Set(
    (data.viewerAccounts ?? [])
      .filter((account) => {
        const provider = findCredentialGroupProviderFromProviderId(account.providerId)
        return provider !== null && data.assistantProviders.includes(provider)
      })
      .map((account) => account.credentialId)
  )
  const mcpProviders = new Map(
    group?.mcpServers.map((server) => [server.id, server.managedConnectorId])
  )
  const entries: MemberIntegration[] = []
  for (const [provider, meta] of LIVE_SEARCH_SOURCE_TYPES) {
    const memberProvider =
      provider === 'slack' ? 'slack' : liveSearchMemberAccountProvider(provider)
    const mcp = liveSearchMcpConnector(provider)
    const accounts: MemberIntegrationAccount[] = mcp
      ? (data.viewerMcpAccounts ?? []).filter(
          (account) => mcpProviders.get(account.mcpServerId) === provider
        )
      : (data.viewerAccounts ?? []).filter(
          (account) =>
            findCredentialGroupProviderFromProviderId(account.providerId) === memberProvider
        )
    const approval = approvals.get(provider)
    const available =
      (provider !== 'hubspot' && provider !== 'zoom') ||
      data.availableMcpConnectors.includes(provider)
    const configured =
      group?.options.some((option) => option.provider === memberProvider) ||
      group?.mcpServers.some((server) => server.managedConnectorId === provider)
    if (
      !LIVE_SEARCH_SCOPE_FIELDS[provider] ||
      (!accounts.length &&
        !configured &&
        (approval?.available === false || !available || !approval?.approved))
    )
      continue
    const options =
      group?.options.filter(
        (option) =>
          option.provider === memberProvider &&
          option.status === 'active' &&
          option.configurationStatus === 'ready' &&
          (provider !== 'slack' ||
            (option.provider === 'slack' && hasSlackSearchUserScopes(option.requiredScopes)))
      ) ?? []
    const servers = mcp
      ? (group?.mcpServers.filter(
          (server) => server.managedConnectorId === provider && server.enabled
        ) ?? [])
      : []
    const option = options.find(
      (candidate) =>
        !accounts.some((account) => 'optionId' in account && account.optionId === candidate.id)
    )
    const server = servers.find(
      (candidate) =>
        !accounts.some(
          (account) => 'mcpServerId' in account && account.mcpServerId === candidate.id
        )
    )
    const ready =
      (mcp
        ? available
        : memberProvider !== null && data.availableProviders.includes(memberProvider)) &&
      approval?.available !== false &&
      group?.status === 'active' &&
      (options.length > 0 || servers.length > 0) &&
      approval?.approved === true &&
      available
    const description =
      provider === 'gitlab'
        ? 'Access follows project permissions'
        : !policies
          ? undefined
          : approval?.available === false
            ? 'Currently unavailable'
            : !approval?.approved
              ? 'Disabled by your organization'
              : group && group.status !== 'active'
                ? 'Connections are paused by your organization'
                : !ready
                  ? 'Not configured'
                  : approval.policy?.accessMode === 'service_account'
                    ? 'Selected resources you can access'
                    : 'All accessible content'
    entries.push({
      id: `source:${provider}`,
      provider,
      name: meta.name,
      icon: meta.icon,
      accounts,
      ready,
      managed: provider === 'gitlab',
      description,
      permissionAccountIds: accounts
        .filter((account) => permissionIds.has(account.credentialId))
        .map((account) => account.credentialId),
      reconnectAccountIds: ready
        ? accounts
            .filter((account) =>
              'optionId' in account
                ? options.some((candidate) => candidate.id === account.optionId)
                : servers.some((candidate) => candidate.id === account.mcpServerId)
            )
            .map((account) => account.credentialId)
        : [],
      connectionTarget: server
        ? { mcpServerId: server.id }
        : option
          ? { optionId: option.id }
          : undefined,
    })
  }
  const { providers, configured } = assistantAccountOptions(data, '')
  for (const provider of new Set(configured.map((option) => option.provider))) {
    const options = configured.filter((option) => option.provider === provider)
    const accounts = (data.viewerAccounts ?? []).filter((account) =>
      options.some((option) => option.id === account.optionId)
    )
    const source = assistantSearchSourceForProvider(getCredentialGroupProviderId(provider))
    const policy = source ? approvals.get(source) : undefined
    const readyOptions = options.filter(
      (option) =>
        group?.status === 'active' &&
        option.status === 'active' &&
        option.configurationStatus === 'ready' &&
        providers.includes(provider) &&
        data.availableProviders.includes(provider) &&
        (!source || (policy?.approved === true && policy.available !== false))
    )
    const target = readyOptions.find(
      (option) => !accounts.some((account) => account.optionId === option.id)
    )
    const service = getCredentialGroupProviderService(provider)
    entries.push({
      id: `app:${provider}`,
      provider,
      name: service.name,
      icon: service.icon,
      accounts,
      ready: readyOptions.length > 0,
      description:
        source && !policies
          ? undefined
          : readyOptions.length
            ? undefined
            : 'Connections unavailable',
      connectionTarget: target ? { optionId: target.id } : undefined,
      permissionAccountIds: accounts
        .filter((account) => permissionIds.has(account.credentialId))
        .map((account) => account.credentialId),
      reconnectAccountIds: accounts
        .filter((account) => readyOptions.some((option) => option.id === account.optionId))
        .map((account) => account.credentialId),
    })
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

export function memberIntegrationStatus(entry: MemberIntegration) {
  if (entry.managed) return 'Organization managed'
  if (!entry.ready) return entry.description ?? 'Checking availability'
  if (
    entry.accounts.some(
      (account) =>
        account.status === 'needs_reauth' &&
        entry.reconnectAccountIds.includes(account.credentialId)
    )
  )
    return 'Reconnect needed'
  if (entry.accounts.length)
    return entry.accounts.length === 1 ? '1 account' : `${entry.accounts.length} accounts`
  return 'Not connected'
}
