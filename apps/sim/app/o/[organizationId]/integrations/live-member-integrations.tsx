'use client'

import type { ReactNode } from 'react'
import { ChipLink } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { organizationRoutes } from '@/lib/navigation/paths'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { IntegrationDetail } from '@/app/o/[organizationId]/integrations/integration-detail'
import {
  integrationViewParsers,
  serializeIntegrationView,
} from '@/app/o/[organizationId]/integrations/search-params'
import {
  memberIntegrationEntries,
  memberIntegrationStatus,
} from '@/app/o/[organizationId]/integrations/utils'
import {
  GenericSecretSourceIcon,
  GenericSecretSourceRow,
} from '@/app/o/[organizationId]/settings/components/integrations/generic-secret-source'
import { CredentialDetailLayout } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useOrganizationSecretSource } from '@/hooks/queries/organization-secrets'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'

interface LiveMemberIntegrationsProps {
  organizationId: string
  search: string
  navigationSearch: string
  intro?: ReactNode
  action?: ReactNode
}

/** Member integrations share one inventory and the platform's list/detail layout. */
export function LiveMemberIntegrations({
  organizationId,
  search,
  navigationSearch,
  intro,
  action,
}: LiveMemberIntegrationsProps) {
  const [{ integration, account }] = useQueryStates(integrationViewParsers)
  const inventory = useOrganizationAccounts(organizationId)
  const policies = useSearchIntegrations(organizationId)
  const secrets = useOrganizationSecretSource(organizationId)
  const routes = organizationRoutes(organizationId)
  const href = (selected: string | null, selectedAccount: string | null = null) =>
    serializeIntegrationView(routes.integrations, {
      q: navigationSearch,
      integration: selected,
      account: selectedAccount,
    })
  const entries = inventory.data
    ? memberIntegrationEntries(inventory.data, policies.isSuccess ? policies.data : undefined)
    : []
  const selected = entries.find((entry) => entry.id === integration)
  const status = inventory.error ? (
    <SettingsQueryErrorState
      error={inventory.error}
      fallback='Could not load your connections'
      isRetrying={inventory.isFetching}
      onRetry={() => void inventory.refetch()}
      variant='inline'
    />
  ) : !inventory.data ? (
    <SettingsEmptyState variant='inline'>Loading your connections</SettingsEmptyState>
  ) : null
  const errors = (
    <>
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
    </>
  )
  if (integration) {
    const back = (
      <ChipLink href={href(account ? integration : null)} leftIcon={ArrowLeft}>
        {account ? (selected?.name ?? 'Integration') : 'Integrations'}
      </ChipLink>
    )
    if (selected && !status) {
      return (
        <IntegrationDetail
          key={selected.id}
          organizationId={organizationId}
          integration={selected}
          accountId={account}
          accountHref={(credentialId) => href(selected.id, credentialId)}
          back={back}
        >
          {errors}
        </IntegrationDetail>
      )
    }
    return (
      <CredentialDetailLayout back={back}>
        {status ?? (
          <>
            {errors}
            {integration === 'secrets' ? (
              secrets.data?.source ? (
                <GenericSecretSourceRow
                  organizationId={organizationId}
                  source={secrets.data.source}
                />
              ) : (
                <SettingsEmptyState variant='inline'>
                  {secrets.isPending
                    ? 'Loading connection'
                    : 'This integration is no longer available.'}
                </SettingsEmptyState>
              )
            ) : (
              <SettingsEmptyState variant='inline'>
                {policies.isPending
                  ? 'Loading connection'
                  : 'This integration is no longer available.'}
              </SettingsEmptyState>
            )}
          </>
        )}
      </CredentialDetailLayout>
    )
  }
  const query = search.trim().toLowerCase()
  const visible = entries.filter((entry) =>
    [entry.provider, entry.name, ...entry.accounts.map((item) => item.displayName)]
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
  const showSecrets = secrets.data?.source && 'generic secrets'.includes(query)
  return (
    <OrganizationPage
      title='Integrations'
      searchMode='expanded'
      searchPlaceholder='Search integrations'
      action={action}
    >
      {intro}
      {status ?? (
        <div className={RESOURCE_LIST_STACK}>
          {errors}
          {showSecrets && (
            <SettingsResourceRow
              iconVariant='custom'
              icon={<GenericSecretSourceIcon />}
              title='Generic Secrets'
              description={
                secrets.data?.source?.mode === 'organization'
                  ? 'Organization managed'
                  : 'Personal secrets'
              }
              href={
                secrets.data?.source?.mode === 'member'
                  ? serializeIntegrationView(routes.memberSecrets, { q: navigationSearch })
                  : href('secrets')
              }
              clickLabel='Open Generic Secrets integration'
              navigable
            />
          )}
          {visible.map((entry) => (
            <SettingsResourceRow
              key={entry.id}
              iconVariant='custom'
              icon={<IntegrationTile blockType={entry.provider} icon={entry.icon} />}
              title={entry.name}
              description={memberIntegrationStatus(entry)}
              href={href(entry.id)}
              clickLabel={`Open ${entry.name} integration`}
              navigable
            />
          ))}
          {!visible.length && !showSecrets && policies.isSuccess && secrets.isSuccess && (
            <SettingsEmptyState variant='inline'>
              {query ? 'No matching integrations' : 'No integrations available'}
            </SettingsEmptyState>
          )}
        </div>
      )}
    </OrganizationPage>
  )
}
