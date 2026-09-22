'use client'

import { Chip, toast } from '@sim/emcn'
import type { OrganizationAccountConnectionResponse } from '@/lib/api/contracts/organization-accounts'
import { connectorDisplayName, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
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

const SOURCES: Record<string, string> = {
  'google-drive': 'google_drive',
  gmail: 'gmail',
  'google-email': 'gmail',
  'google-calendar': 'google_calendar',
  'google-docs': 'google_drive',
  'google-sheets': 'google_drive',
  'google-slides': 'google_drive',
  'github-repositories': 'github',
  slack: 'slack',
  jira: 'jira',
  confluence: 'confluence',
}

interface LiveMemberIntegrationsProps {
  organizationId: string
  search: string
}

/** Personal OAuth apps and administrator-managed GitLab have distinct connection states. */
export function LiveMemberIntegrations({ organizationId, search }: LiveMemberIntegrationsProps) {
  const inventory = useOrganizationAccounts(organizationId)
  const policies = useSearchIntegrations(organizationId)
  const secrets = useOrganizationSecretSource(organizationId)
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const navigate = (result: OrganizationAccountConnectionResponse) =>
    window.location.assign(result.authorizationUrl ?? result.invitationLink)
  const onError = (error: Error) => toast.error(error.message)
  const error = inventory.error ?? policies.error ?? secrets.error
  if (error)
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Could not load your connections'
        isRetrying={inventory.isFetching || policies.isFetching || secrets.isFetching}
        onRetry={() => {
          void inventory.refetch()
          void policies.refetch()
          void secrets.refetch()
        }}
        variant='inline'
      />
    )
  if (!inventory.data || !policies.data || !secrets.data)
    return <SettingsEmptyState variant='inline'>Loading your connections…</SettingsEmptyState>
  const data = inventory.data
  const approvals = new Map(policies.data.map((policy) => [policy.connectorType, policy]))
  const group = data.credentialGroup
  const codaServerIds = new Set(
    group?.mcpServers
      .filter((server) => server.managedConnectorId === 'coda')
      .map((server) => server.id)
  )
  const codaAccounts = (data.viewerMcpAccounts ?? []).filter((account) =>
    codaServerIds.has(account.mcpServerId)
  )
  const available = SEARCH_SOURCE_TYPES.filter(
    ([provider]) =>
      LIVE_SEARCH_SCOPE_FIELDS[provider] &&
      (approvals.get(provider)?.approved ||
        data.viewerAccounts?.some((account) => SOURCES[account.providerId] === provider) ||
        (provider === 'coda' && codaAccounts.length))
  )
  const query = search.trim().toLowerCase()
  const visible = available.filter(([provider, meta]) =>
    `${provider} ${meta.name} ${(data.viewerAccounts ?? [])
      .filter((account) => SOURCES[account.providerId] === provider)
      .map((account) => account.displayName)
      .join(' ')}`
      .toLowerCase()
      .includes(query)
  )
  const pending = connect.isPending || reconnect.isPending
  const secretSource = secrets.data.source
  const showSecrets = secretSource && 'generic secrets'.includes(query)
  if (available.length === 0 && !secretSource) return null
  return (
    <div className='flex flex-col gap-3'>
      {showSecrets && (
        <GenericSecretSourceRow organizationId={organizationId} source={secretSource} />
      )}
      {visible.map(([provider, meta]) => {
        const approval = approvals.get(provider)
        const approved = approval?.approved === true
        const name = connectorDisplayName(provider)
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
        const option = group?.options.find(
          (option) => SOURCES[option.provider] === provider && option.status === 'active'
        )
        const server =
          provider === 'coda'
            ? group?.mcpServers.find(
                (server) => server.managedConnectorId === 'coda' && server.enabled
              )
            : undefined
        const accounts =
          provider === 'coda'
            ? codaAccounts
            : (data.viewerAccounts ?? []).filter(
                (account) => SOURCES[account.providerId] === provider
              )
        const ready =
          group?.status === 'active' &&
          Boolean(option || server) &&
          approved &&
          (!option || option.configurationStatus === 'ready')
        const scope =
          approval?.policy?.accessMode === 'service_account'
            ? 'Selected resources you can access'
            : 'All accessible content'
        const state = !approved
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
              <div className='flex flex-wrap items-center justify-end gap-2'>
                <DisconnectAccountMenu
                  organizationId={organizationId}
                  integrationName={name}
                  accounts={accounts}
                />
                {accounts
                  .filter((account) => account.status === 'needs_reauth')
                  .map((account) => (
                    <Chip
                      key={account.credentialId}
                      disabled={pending || !ready}
                      onClick={() =>
                        reconnect.mutate(account.credentialId, { onSuccess: navigate, onError })
                      }
                    >
                      Reconnect{accounts.length > 1 ? ` ${account.displayName}` : ''}
                    </Chip>
                  ))}
                {approved && (
                  <Chip
                    variant={accounts.length ? undefined : 'primary'}
                    disabled={pending || !ready}
                    onClick={() =>
                      connect.mutate(
                        {
                          organizationId,
                          ...(server ? { mcpServerId: server.id } : { optionId: option!.id }),
                        },
                        { onSuccess: navigate, onError }
                      )
                    }
                  >
                    {pending &&
                    connect.variables?.organizationId === organizationId &&
                    (('optionId' in connect.variables &&
                      connect.variables.optionId === option?.id) ||
                      ('mcpServerId' in connect.variables &&
                        connect.variables.mcpServerId === server?.id))
                      ? 'Connecting…'
                      : accounts.length
                        ? 'Add account'
                        : 'Connect'}
                  </Chip>
                )}
              </div>
            }
          />
        )
      })}
      {!visible.length && !showSecrets && query && (
        <SettingsEmptyState variant='inline'>No matching integrations</SettingsEmptyState>
      )}
    </div>
  )
}
