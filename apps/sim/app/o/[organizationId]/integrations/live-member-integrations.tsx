'use client'

import { Chip, ChipLink, toast } from '@sim/emcn'
import type { OrganizationAccountConnectionResponse } from '@/lib/api/contracts/organization-accounts'
import { connectorDisplayName, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
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
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const navigate = (result: OrganizationAccountConnectionResponse) =>
    window.location.assign(result.authorizationUrl ?? result.invitationLink)
  const onError = (error: Error) => toast.error(error.message)
  const error = inventory.error ?? policies.error
  if (error)
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Could not load your connections'
        isRetrying={inventory.isFetching || policies.isFetching}
        onRetry={() => {
          void inventory.refetch()
          void policies.refetch()
        }}
        variant='inline'
      />
    )
  if (!inventory.data || !policies.data)
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
  return (
    <div className='flex flex-col gap-3'>
      <p className='px-4 py-2 text-[var(--text-muted)] text-small'>
        Connect your apps to search current documents, messages, and code. Your organization sets
        the search scope.
      </p>
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
              description='Your organization manages this connection. Results follow your GitLab source permissions.'
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
          approval?.policy?.mode === 'selected'
            ? `${approval.policy.included.length} selected sources`
            : 'Your accessible content'
        const state = !approved
          ? 'Disabled by your organization'
          : group && group.status !== 'active'
            ? 'Connections are paused by your organization'
            : !ready
              ? 'An admin needs to finish connection setup'
              : accounts.length
                ? scope
                : `Connect your ${name} account`
        const description = `${accounts.map((account) => `${account.displayName}${account.status === 'needs_reauth' ? ' · Reconnect needed' : ''}`).join(', ')}${accounts.length ? ' · ' : ''}${state}`
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
                {ready ? (
                  <Chip
                    variant={accounts.length ? undefined : 'primary'}
                    disabled={pending}
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
                ) : data.canManage && approved ? (
                  <ChipLink
                    href={`/o/${organizationId}/settings/integrations?live-tab=connections`}
                  >
                    Finish setup
                  </ChipLink>
                ) : null}
              </div>
            }
          />
        )
      })}
      {!visible.length && (
        <SettingsEmptyState variant='inline'>
          {query
            ? 'No integrations match your search.'
            : 'Your organization hasn’t enabled any search integrations yet.'}
        </SettingsEmptyState>
      )}
      {data.canManage && (
        <div className='px-4'>
          <ChipLink href={`/o/${organizationId}/settings/integrations`}>
            Manage search integrations
          </ChipLink>
        </div>
      )}
    </div>
  )
}
