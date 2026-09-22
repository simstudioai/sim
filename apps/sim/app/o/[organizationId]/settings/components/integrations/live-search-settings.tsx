'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipLink, toast } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { SettingsPanel } from '@/components/settings/settings-panel'
import type { SearchIntegrationApproval } from '@/lib/api/contracts/knowledge/search-integrations'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  getConnectorAccessAvailability,
  SEARCH_SOURCE_TYPES,
  searchMemberAccountProvider,
} from '@/lib/sim-search/connectors'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SCOPE_FIELDS,
  LIVE_SEARCH_SERVICE_PROVIDERS,
} from '@/lib/sim-search/live/policy-schema'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { AddOrganizationSourceModal } from '@/app/o/[organizationId]/settings/components/integrations/add-organization-source-modal'
import {
  GENERIC_SECRETS_META,
  GENERIC_SECRETS_SOURCE_TYPE,
  GenericSecretSourceModal,
  GenericSecretSourceRow,
} from '@/app/o/[organizationId]/settings/components/integrations/generic-secret-source'
import { LiveSearchPolicyModal } from '@/app/o/[organizationId]/settings/components/integrations/live-search-policy-modal'
import { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useOrganizationSecretSource } from '@/hooks/queries/organization-secrets'
import {
  useSearchIntegrations,
  useUpdateSearchIntegration,
} from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export function LiveSearchSettings() {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const policies = useSearchIntegrations(organization.id)
  const secrets = useOrganizationSecretSource(organization.id)
  const accounts = useOrganizationAccounts(viewer.isAdmin ? organization.id : undefined)
  const update = useUpdateSearchIntegration()
  const availability = usePermissionConfig()
  const router = useRouter()
  const [search, setSearch] = useSettingsSearch()
  const [editing, setEditing] = useState<SearchIntegrationApproval | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingSecrets, setAddingSecrets] = useState(false)
  const [, setConnectedAccounts] = useQueryState(
    connectedAccountsParam.key,
    connectedAccountsParam.parser
  )
  if (!viewer.isAdmin) return null

  const added =
    policies.data?.filter((row) => row.approved && LIVE_SEARCH_SCOPE_FIELDS[row.connectorType]) ??
    []
  const visible = added.filter((integration) =>
    SEARCH_SOURCE_TYPES.some(
      ([type, meta]) =>
        type === integration.connectorType && meta.name.toLowerCase().includes(search.toLowerCase())
    )
  )
  const secretSource = secrets.data?.source
  const showSecrets =
    secretSource && GENERIC_SECRETS_META.name.toLowerCase().includes(search.toLowerCase())
  const availableToAdd = [
    ...SEARCH_SOURCE_TYPES.filter(
      ([type]) => LIVE_SEARCH_SCOPE_FIELDS[type] && !added.some((row) => row.connectorType === type)
    ).map(([type, meta]) => ({
      type,
      meta,
      access: getConnectorAccessAvailability(meta, availability.integrationAvailability, {
        memberAccessAvailable: searchAccess.memberScoped,
        mirroredAccessAvailable: searchAccess.sourceMirrored,
        oauthServiceAvailability: availability.oauthServiceAvailability,
        isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
      }),
    })),
    ...(!secretSource
      ? [
          {
            type: GENERIC_SECRETS_SOURCE_TYPE,
            meta: GENERIC_SECRETS_META,
            access: { admin: true, members: true },
          },
        ]
      : []),
  ]
  const routes = organizationRoutes(organization.id)

  return (
    <SettingsPanel
      actions={[
        {
          text: 'Add source',
          icon: Plus,
          variant: 'primary',
          disabled: !policies.data || !secrets.data || !availableToAdd.length || update.isPending,
          onSelect: () => setAdding(true),
        },
      ]}
      search={{ value: search, onChange: setSearch, placeholder: 'Search sources…' }}
    >
      {policies.error || secrets.error ? (
        <SettingsQueryErrorState
          error={policies.error ?? secrets.error}
          fallback='Could not load sources'
          isRetrying={policies.isFetching || secrets.isFetching}
          onRetry={() => {
            void policies.refetch()
            void secrets.refetch()
          }}
          variant='inline'
        />
      ) : !policies.data || !secrets.data ? (
        <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
      ) : added.length === 0 && !secretSource && !search ? (
        <SettingsEmptyState>No sources yet. Add a source to get started.</SettingsEmptyState>
      ) : (
        <>
          <div className={RESOURCE_LIST_STACK}>
            {showSecrets && (
              <GenericSecretSourceRow
                organizationId={organization.id}
                source={secretSource}
                admin
              />
            )}
            {visible.map((integration) => {
              const [type, meta] = SEARCH_SOURCE_TYPES.find(
                ([sourceType]) => sourceType === integration.connectorType
              )!
              const serviceAccount =
                type === 'gitlab' || integration.policy?.accessMode === 'service_account'
              const memberProvider = searchMemberAccountProvider(type)
              const needsMemberSetup =
                memberProvider &&
                accounts.data &&
                !accounts.data.credentialGroup?.options.some(
                  (option) =>
                    option.provider === memberProvider &&
                    option.status === 'active' &&
                    option.configurationStatus === 'ready'
                )
              const scope = serviceAccount
                ? type === 'gitlab'
                  ? 'Projects and permissions'
                  : type === 'github'
                    ? 'GitHub App repositories'
                    : integration.policy?.sourceId
                      ? 'Service account'
                      : 'Service account · Add a connection'
                : 'Member accounts'
              return (
                <SettingsResourceRow
                  key={type}
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={meta.name}
                  description={scope}
                  trailing={
                    <div className='flex gap-2'>
                      {serviceAccount && (
                        <ChipLink href={routes.searchProvider(type)}>
                          {type === 'gitlab'
                            ? 'Projects'
                            : type === 'github'
                              ? 'Repositories'
                              : 'Connections'}
                        </ChipLink>
                      )}
                      {type === 'slack' && (
                        <Chip onClick={() => void setConnectedAccounts('slack')}>Slack app</Chip>
                      )}
                      {needsMemberSetup && (
                        <Chip
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate(
                              {
                                organizationId: organization.id,
                                connectorType: type,
                                approved: true,
                                policy: integration.policy ?? defaultLiveSearchPolicy(type),
                              },
                              {
                                onSuccess: () => toast.success('Source settings saved'),
                                onError: (error) => toast.error(error.message),
                              }
                            )
                          }
                        >
                          Set up accounts
                        </Chip>
                      )}
                      {LIVE_SEARCH_SERVICE_PROVIDERS.includes(type) && type !== 'gitlab' && (
                        <Chip onClick={() => setEditing(integration)}>Configure</Chip>
                      )}
                      <RowActionsMenu
                        label={`${meta.name} source actions`}
                        actions={[
                          {
                            label: 'Remove source',
                            destructive: true,
                            disabled: update.isPending,
                            onSelect: () => setRemoving(type),
                          },
                        ]}
                      />
                    </div>
                  }
                />
              )
            })}
          </div>
          {search && visible.length === 0 && !showSecrets && (
            <SettingsEmptyState variant='inline'>No matching sources</SettingsEmptyState>
          )}
        </>
      )}
      {editing && (
        <LiveSearchPolicyModal
          key={editing.connectorType}
          organizationId={organization.id}
          integration={editing}
          onClose={() => setEditing(null)}
        />
      )}
      <OrganizationSlackAccountSetup />
      {addingSecrets && (
        <GenericSecretSourceModal
          organizationId={organization.id}
          source={null}
          onClose={() => setAddingSecrets(false)}
        />
      )}
      <ChipConfirmModal
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setRemoving(null)
        }}
        title={`Remove ${removing ? SEARCH_SOURCE_TYPES.find(([type]) => type === removing)?.[1].name : ''} source?`}
        text='Members will no longer be able to search this source.'
        confirm={{
          label: 'Remove source',
          variant: 'destructive',
          pending: update.isPending,
          onClick: () => {
            if (!removing) return
            update.mutate(
              { organizationId: organization.id, connectorType: removing, approved: false },
              {
                onSuccess: () => setRemoving(null),
                onError: (error) => toast.error(error.message),
              }
            )
          },
        }}
      />
      {adding && (
        <AddOrganizationSourceModal
          sources={availableToAdd}
          compact
          descriptions={Object.fromEntries(
            availableToAdd.map(({ type, access }) => [
              type,
              type === GENERIC_SECRETS_SOURCE_TYPE
                ? 'Organization or member secrets'
                : type === 'github'
                  ? 'GitHub App repositories'
                  : type === 'gitlab'
                    ? 'Projects and permissions'
                    : access.admin
                      ? 'Service account or member accounts'
                      : 'Member accounts',
            ])
          )}
          pending={update.isPending}
          ready={availability.isIntegrationAvailabilityReady}
          feedback={null}
          onClose={() => setAdding(false)}
          onSelect={(type, mode) => {
            if (type === GENERIC_SECRETS_SOURCE_TYPE) {
              setAdding(false)
              setAddingSecrets(true)
              return
            }
            if (type === 'gitlab' || !LIVE_SEARCH_SERVICE_PROVIDERS.includes(type)) {
              update.mutate(
                {
                  organizationId: organization.id,
                  connectorType: type,
                  approved: true,
                  policy: defaultLiveSearchPolicy(type),
                },
                {
                  onSuccess: () => {
                    setAdding(false)
                    if (type === 'gitlab') router.push(routes.searchProvider(type))
                    if (type === 'slack') void setConnectedAccounts('slack')
                  },
                  onError: (error) => toast.error(error.message),
                }
              )
              return
            }
            setAdding(false)
            setEditing({
              connectorType: type,
              approved: false,
              policy: {
                ...defaultLiveSearchPolicy(type),
                accessMode: mode === 'admin' || type === 'github' ? 'service_account' : 'member',
              },
            })
          }}
        />
      )}
    </SettingsPanel>
  )
}
