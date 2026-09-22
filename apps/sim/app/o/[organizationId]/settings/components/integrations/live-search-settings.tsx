'use client'

import { useState } from 'react'
import { Chip, ChipLink, ChipSwitch, toast } from '@sim/emcn'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { SettingsPanel } from '@/components/settings/settings-panel'
import type { SearchIntegrationApproval } from '@/lib/api/contracts/knowledge/search-integrations'
import { SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { LiveSearchPolicyModal } from '@/app/o/[organizationId]/settings/components/integrations/live-search-policy-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { OrganizationAccountProviders } from '@/ee/credential-groups/components/organization-account-providers'
import {
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'

export function LiveSearchSettings() {
  const { organization, viewer } = useOrganizationContext()
  const policies = useSearchIntegrations(organization.id)
  const accounts = useOrganizationAccounts(viewer.isAdmin ? organization.id : undefined)
  const ensure = useEnsureOrganizationAccounts()
  const update = useUpdateOrganizationAccounts()
  const [tab, setTab] = useQueryState(
    'live-tab',
    parseAsStringLiteral(['sources', 'connections', 'people'] as const).withDefault('sources')
  )
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<SearchIntegrationApproval | null>(null)
  if (!viewer.isAdmin) return null
  const group = accounts.data?.credentialGroup
  const error = policies.error ?? accounts.error
  const enabled =
    policies.data?.filter((row) => row.approved && LIVE_SEARCH_SCOPE_FIELDS[row.connectorType])
      .length ?? 0
  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex flex-col gap-1'>
          <p className='font-medium text-[var(--text-primary)]'>Search connected apps</p>
          <p className='text-[var(--text-muted)] text-small'>
            Choose where members can search. Results always follow their access in each app.
          </p>
        </div>
        <ChipLink href={`/o/${organization.id}/integrations`}>My connections</ChipLink>
      </div>
      <div>
        <ChipSwitch
          aria-label='Search settings'
          value={tab}
          onChange={(value) => {
            void setTab(value)
          }}
          options={[
            { value: 'sources', label: 'Search scope' },
            { value: 'connections', label: 'Connection setup' },
            { value: 'people', label: 'People' },
          ]}
        />
      </div>
      {error ? (
        <SettingsQueryErrorState
          error={error}
          fallback='Could not load search settings'
          isRetrying={policies.isFetching || accounts.isFetching}
          onRetry={() => {
            ensure.reset()
            void policies.refetch()
            void accounts.refetch()
          }}
          variant='inline'
        />
      ) : !policies.data || !accounts.data ? (
        <SettingsEmptyState variant='inline'>Loading search settings…</SettingsEmptyState>
      ) : (
        <>
          {tab === 'sources' && (
            <SettingsPanel
              search={{ value: search, onChange: setSearch, placeholder: 'Search integrations…' }}
            >
              <p className='mb-4 text-[var(--text-muted)] text-small'>
                {enabled} {enabled === 1 ? 'integration' : 'integrations'} enabled. Changes apply to
                searches and document reads immediately.
              </p>
              <div className={RESOURCE_LIST_STACK}>
                {SEARCH_SOURCE_TYPES.filter(
                  ([id, meta]) =>
                    LIVE_SEARCH_SCOPE_FIELDS[id] &&
                    meta.name.toLowerCase().includes(search.toLowerCase())
                ).map(([id, meta]) => {
                  const integration = policies.data!.find((row) => row.connectorType === id) ?? {
                    connectorType: id,
                    approved: false,
                  }
                  const policy = integration.policy
                  const scope =
                    policy?.mode === 'selected'
                      ? `${policy.included.length} selected ${policy.included.length === 1 ? 'source' : 'sources'}`
                      : id === 'gitlab'
                        ? 'Configured projects'
                        : 'All accessible sources'
                  return (
                    <SettingsResourceRow
                      key={id}
                      iconVariant='custom'
                      icon={<IntegrationTile blockType={id} icon={meta.icon} />}
                      title={meta.name}
                      description={
                        integration.approved
                          ? `${scope}${policy?.excluded.length ? ` · ${policy.excluded.length} excluded` : ''}`
                          : 'Disabled for organization search'
                      }
                      trailing={
                        <div className='flex gap-2'>
                          {id === 'gitlab' && integration.approved && (
                            <ChipLink
                              href={`/o/${organization.id}/settings/integrations/providers/gitlab`}
                            >
                              Projects
                            </ChipLink>
                          )}
                          <Chip onClick={() => setEditing(integration)}>
                            {integration.approved ? 'Configure' : 'Enable'}
                          </Chip>
                        </div>
                      }
                    />
                  )
                })}
              </div>
              {!SEARCH_SOURCE_TYPES.some(
                ([id, meta]) =>
                  LIVE_SEARCH_SCOPE_FIELDS[id] &&
                  meta.name.toLowerCase().includes(search.toLowerCase())
              ) && (
                <SettingsEmptyState variant='inline'>
                  No integrations match your search.
                </SettingsEmptyState>
              )}
            </SettingsPanel>
          )}
          {tab === 'connections' && (
            <div className='flex flex-col gap-4'>
              <SettingsResourceRow
                title='GitLab projects'
                description='Configure your GitLab instance, project token, and access permissions.'
                trailing={
                  <ChipLink href={`/o/${organization.id}/settings/integrations/providers/gitlab`}>
                    Manage projects
                  </ChipLink>
                }
              />
              {group?.status !== 'active' && group && (
                <SettingsEmptyState variant='inline'>
                  Account connections are paused.{' '}
                  <Chip
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate(
                        {
                          organizationId: organization.id,
                          groupId: group.id,
                          update: { status: 'active' },
                        },
                        { onError: (error) => toast.error(error.message) }
                      )
                    }
                  >
                    {update.isPending ? 'Resuming…' : 'Resume connections'}
                  </Chip>
                </SettingsEmptyState>
              )}
              {ensure.error && (
                <SettingsEmptyState variant='inline' tone='error'>
                  {ensure.error.message}
                </SettingsEmptyState>
              )}
            </div>
          )}
          {tab === 'connections' &&
            (group ? (
              <>
                <p className='text-[var(--text-muted)] text-small'>
                  Set up sign-in so members can connect their own accounts. GitLab connections and
                  project permissions are managed by admins.
                </p>
                <OrganizationAccountProviders
                  visibleProviders={[
                    'google-drive',
                    'gmail',
                    'google-calendar',
                    'slack',
                    'github-repositories',
                    'jira',
                    'confluence',
                  ]}
                  availableMcpConnectors={['coda']}
                  organizationId={organization.id}
                  group={group}
                  availableProviders={accounts.data.availableProviders.filter((provider) =>
                    [
                      'google-drive',
                      'gmail',
                      'google-calendar',
                      'slack',
                      'github-repositories',
                      'jira',
                      'confluence',
                    ].includes(provider)
                  )}
                />
              </>
            ) : (
              <div className='flex flex-col items-start gap-4'>
                <p className='text-small'>
                  Set up account connections so members can sign in to their apps.
                </p>
                <Chip
                  variant='primary'
                  disabled={ensure.isPending}
                  onClick={() => ensure.mutate({ organizationId: organization.id })}
                >
                  {ensure.isPending ? 'Setting up…' : 'Set up connections'}
                </Chip>
              </div>
            ))}
          {tab === 'people' &&
            (group ? (
              <OrganizationAccountPeople
                organizationId={organization.id}
                requestDisabled={
                  group.status !== 'active' ||
                  (!group.options.length && !group.mcpServers.some((server) => server.enabled))
                }
              />
            ) : (
              <SettingsEmptyState variant='inline'>
                Set up connections to manage member accounts.
              </SettingsEmptyState>
            ))}
        </>
      )}
      {editing && (
        <LiveSearchPolicyModal
          key={editing.connectorType}
          organizationId={organization.id}
          integration={editing.approved ? editing : { ...editing, approved: true }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
