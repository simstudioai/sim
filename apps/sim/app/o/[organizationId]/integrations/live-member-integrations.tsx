'use client'

import { toast } from '@sim/emcn'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
import { hasSlackSearchUserScopes } from '@/lib/credential-groups/slack-managed-user-scopes'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'
import {
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
} from '@/lib/sim-search/live/source-catalog'
import { AccountActionsMenu } from '@/app/o/[organizationId]/integrations/account-actions-menu'
import { AssistantAccountIntegrations } from '@/app/o/[organizationId]/integrations/assistant-account-integrations'
import { assistantAccountOptions } from '@/app/o/[organizationId]/integrations/utils'
import { GenericSecretSourceRow } from '@/app/o/[organizationId]/settings/components/integrations/generic-secret-source'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useConnectOrganizationAccount,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationSecretSource } from '@/hooks/queries/organization-secrets'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'

interface LiveMemberIntegrationsProps {
  organizationId: string
  search: string
}

/** Personal OAuth apps and administrator-managed GitLab have distinct connection states. */
export function LiveMemberIntegrations({ organizationId, search }: LiveMemberIntegrationsProps) {
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const onError = (error: Error) => toast.error(error.message)
  const inventory = useOrganizationAccounts(organizationId)
  const policies = useSearchIntegrations(organizationId)
  const secrets = useOrganizationSecretSource(organizationId)
  if (inventory.error)
    return (
      <SettingsQueryErrorState
        error={inventory.error}
        fallback='Could not load your connections'
        isRetrying={inventory.isFetching}
        onRetry={() => void inventory.refetch()}
        variant='inline'
      />
    )
  if (!inventory.data)
    return <SettingsEmptyState variant='inline'>Loading your connections</SettingsEmptyState>
  const data = inventory.data
  const loadedPolicies = policies.isSuccess ? policies.data : undefined
  const approvals = new Map(loadedPolicies?.map((policy) => [policy.connectorType, policy]))
  const permissionAccountIds = (data.viewerAccounts ?? [])
    .filter((account) => {
      const provider = findCredentialGroupProviderFromProviderId(account.providerId)
      return provider !== null && data.assistantProviders.includes(provider)
    })
    .map((account) => account.credentialId)
  const group = data.credentialGroup
  const mcpProviders = new Map(
    group?.mcpServers.map((server) => [server.id, server.managedConnectorId])
  )
  const mcpAccounts = (provider: string) =>
    (data.viewerMcpAccounts ?? []).filter(
      (account) => mcpProviders.get(account.mcpServerId) === provider
    )
  const accountsForProvider = (provider: string) => {
    if (liveSearchMcpConnector(provider)) return mcpAccounts(provider)
    const memberProvider =
      provider === 'slack' ? 'slack' : liveSearchMemberAccountProvider(provider)
    return (data.viewerAccounts ?? []).filter(
      (account) => findCredentialGroupProviderFromProviderId(account.providerId) === memberProvider
    )
  }
  const available = LIVE_SEARCH_SOURCE_TYPES.filter(
    ([provider]) =>
      (approvals.get(provider)?.available !== false || accountsForProvider(provider).length > 0) &&
      LIVE_SEARCH_SCOPE_FIELDS[provider] &&
      ((provider !== 'hubspot' && provider !== 'zoom') ||
        data.availableMcpConnectors.includes(provider) ||
        mcpAccounts(provider).length > 0) &&
      (approvals.get(provider)?.approved || accountsForProvider(provider).length > 0)
  )
  const query = search.trim().toLowerCase()
  const visible = available.filter(([provider, meta]) =>
    `${provider} ${meta.name} ${accountsForProvider(provider)
      .map((account) => account.displayName)
      .join(' ')}`
      .toLowerCase()
      .includes(query)
  )
  const secretSource = secrets.data?.source
  const showSecrets = secretSource && 'generic secrets'.includes(query)
  return (
    <div className='flex flex-col gap-7'>
      <AssistantAccountIntegrations
        organizationId={organizationId}
        search={search}
        data={data}
        policies={loadedPolicies}
      />
      <div className='flex flex-col gap-3'>
        {policies.error && (
          <SettingsQueryErrorState
            error={policies.error}
            fallback='Could not load Search connections'
            isRetrying={policies.isFetching}
            onRetry={() => void policies.refetch()}
            variant='inline'
          />
        )}
        {secrets.error && (
          <SettingsQueryErrorState
            error={secrets.error}
            fallback='Could not load secret connections'
            isRetrying={secrets.isFetching}
            onRetry={() => void secrets.refetch()}
            variant='inline'
          />
        )}
        {showSecrets && (
          <GenericSecretSourceRow organizationId={organizationId} source={secretSource} />
        )}
        {visible.map(([provider, meta]) => {
          const approval = approvals.get(provider)
          const approved = approval?.approved === true
          const name = meta.name
          if (provider === 'gitlab')
            return (
              <SettingsResourceRow
                key={provider}
                iconVariant='custom'
                icon={<IntegrationTile blockType={provider} icon={meta.icon} />}
                title={name}
                description='Access follows project permissions'
                trailing={
                  <span className='text-[var(--text-muted)] text-small'>Organization managed</span>
                }
              />
            )
          const memberProvider =
            provider === 'slack' ? 'slack' : liveSearchMemberAccountProvider(provider)
          const accounts = accountsForProvider(provider)
          const options =
            group?.options.filter(
              (option) =>
                option.provider === memberProvider &&
                option.status === 'active' &&
                option.configurationStatus === 'ready' &&
                (provider !== 'slack' ||
                  (option.provider === 'slack' && hasSlackSearchUserScopes(option.requiredScopes)))
            ) ?? []
          const servers = liveSearchMcpConnector(provider)
            ? (group?.mcpServers.filter(
                (server) => server.managedConnectorId === provider && server.enabled
              ) ?? [])
            : []
          const option = options.find(
            (option) =>
              !accounts.some((account) => 'optionId' in account && account.optionId === option.id)
          )
          const server = servers.find(
            (server) =>
              !accounts.some(
                (account) => 'mcpServerId' in account && account.mcpServerId === server.id
              )
          )
          const connectionTarget = server
            ? { mcpServerId: server.id }
            : option
              ? { optionId: option.id }
              : undefined
          const ready =
            approval?.available !== false &&
            group?.status === 'active' &&
            (options.length > 0 || servers.length > 0) &&
            approved &&
            ((provider !== 'hubspot' && provider !== 'zoom') ||
              data.availableMcpConnectors.includes(provider))
          const reconnectAccountIds = ready
            ? accounts
                .filter((account) =>
                  'optionId' in account
                    ? options.some((option) => option.id === account.optionId)
                    : servers.some((server) => server.id === account.mcpServerId)
                )
                .map((account) => account.credentialId)
            : []
          const scope =
            approval?.policy?.accessMode === 'service_account'
              ? 'Selected resources you can access'
              : 'All accessible content'
          const state = !loadedPolicies
            ? undefined
            : approval?.available === false
              ? 'Currently unavailable'
              : !approved
                ? 'Disabled by your organization'
                : group && group.status !== 'active'
                  ? 'Connections are paused by your organization'
                  : !ready
                    ? 'Not configured'
                    : accounts.length
                      ? scope
                      : undefined
          const description = [
            accounts
              .map(
                (account) =>
                  `${account.displayName}${account.status === 'needs_reauth' ? ' · Reconnect needed' : ''}`
              )
              .join(', '),
            state,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <SettingsResourceRow
              key={provider}
              iconVariant='custom'
              icon={<IntegrationTile blockType={provider} icon={meta.icon} />}
              title={name}
              description={description}
              trailing={
                <AccountActionsMenu
                  organizationId={organizationId}
                  integrationName={name}
                  accounts={accounts}
                  onConnect={
                    approved && connectionTarget
                      ? () => connect.mutate({ organizationId, ...connectionTarget }, { onError })
                      : undefined
                  }
                  onReconnect={(credentialId) => reconnect.mutate(credentialId, { onError })}
                  connectionPending={connect.isPending || reconnect.isPending}
                  connecting={
                    connect.isPending &&
                    (('optionId' in connect.variables &&
                      connect.variables.optionId === option?.id) ||
                      ('mcpServerId' in connect.variables &&
                        connect.variables.mcpServerId === server?.id))
                  }
                  connectionReady={ready}
                  reconnectAccountIds={reconnectAccountIds}
                  permissionAccountIds={permissionAccountIds}
                />
              }
            />
          )
        })}
        {!visible.length &&
          !showSecrets &&
          !assistantAccountOptions(data, search).visible.length &&
          loadedPolicies &&
          secrets.data &&
          query && (
            <SettingsEmptyState variant='inline'>No matching integrations</SettingsEmptyState>
          )}
      </div>
    </div>
  )
}
