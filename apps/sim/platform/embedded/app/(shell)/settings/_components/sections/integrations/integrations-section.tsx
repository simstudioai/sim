'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { SearchIntegrationApproval } from '@/lib/api/contracts/knowledge/search-integrations'
import { assistantAccountOptions } from '@/lib/credential-groups/member-integrations'
import { hasSlackSearchUserScopes } from '@/lib/credential-groups/slack-managed-user-scopes'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SCOPE_FIELDS,
  LIVE_SEARCH_SERVICE_PROVIDERS,
} from '@/lib/sim-search/live/policy-schema'
import {
  getLiveSearchAccessAvailability,
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
} from '@/lib/sim-search/live/source-catalog'
import { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'
import {
  ActionRow,
  Muted,
  SectionSkeleton,
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { AddSourceModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/add-source-modal'
import { AssistantApps } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/assistant-apps'
import {
  GENERIC_SECRETS_NAME,
  GENERIC_SECRETS_SOURCE_TYPE,
  GenericSecretSourceModal,
  GenericSecretSourceRow,
} from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/generic-secrets'
import { PolicyModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/policy-modal'
import { SlackAccountSetup } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/slack-account-setup'
import { SourceSetup } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/source-setup-host'
import { useSourceSettings } from '@/platform/embedded/lib/data/integrations'

export default function IntegrationsSection({ organization: context }: SettingsSectionProps) {
  const { organization, viewer, searchAccess } = context
  const settings = useSourceSettings(organization.id, viewer.isAdmin)
  const { policies, secrets, accounts, added } = settings
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

  const visible = added.filter((integration) =>
    LIVE_SEARCH_SOURCE_TYPES.some(
      ([type, meta]) =>
        type === integration.connectorType && meta.name.toLowerCase().includes(search.toLowerCase())
    )
  )
  const secretSource = secrets.data?.source
  const showSecrets =
    secretSource && GENERIC_SECRETS_NAME.toLowerCase().includes(search.toLowerCase())
  const availableToAdd = [
    ...LIVE_SEARCH_SOURCE_TYPES.filter(
      ([type]) =>
        (type !== 'zoom' ||
          policies.data?.some((row) => row.connectorType === type && row.available !== false)) &&
        LIVE_SEARCH_SCOPE_FIELDS[type] &&
        !added.some((row) => row.connectorType === type)
    ).map(([type, meta]) => ({
      type,
      name: meta.name,
      icon: meta.icon,
      availabilityStatus:
        (type !== 'hubspot' && type !== 'zoom') || accounts.isSuccess
          ? undefined
          : accounts.isError
            ? ('error' as const)
            : ('loading' as const),
      access: getLiveSearchAccessAvailability(type, availability.integrationAvailability, {
        memberAccessAvailable: searchAccess.memberScoped,
        availableMcpConnectors: accounts.data?.availableMcpConnectors,
        mirroredAccessAvailable: searchAccess.sourceMirrored,
        oauthServiceAvailability: availability.oauthServiceAvailability,
        isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
      }),
    })),
    ...(!secretSource
      ? [
          {
            type: GENERIC_SECRETS_SOURCE_TYPE,
            name: GENERIC_SECRETS_NAME,
            icon: undefined,
            availabilityStatus: undefined,
            access: { admin: true, members: true },
          },
        ]
      : []),
  ]
  const routes = organizationRoutes(organization.id)
  const assistantVisible =
    accounts.data && assistantAccountOptions(accounts.data, search).visible.length > 0
  const removingName = removing
    ? LIVE_SEARCH_SOURCE_TYPES.find(([type]) => type === removing)?.[1].name
    : ''

  return (
    <SourceSetup
      scope={{ kind: 'organization', organizationId: organization.id }}
      backLabel='Sources'
      canAdmin={viewer.isAdmin}
      memberAccessAvailable={searchAccess.memberScoped}
      mirroredAccessAvailable={searchAccess.sourceMirrored}
    >
      <SectionStack>
        <SectionToolbar
          grow={<SectionSearch subject='sources' value={search} onValueChange={setSearch} />}
        >
          <Button
            variant='primary'
            size='compact'
            icon='I074'
            disabled={!policies.data || !secrets.data || !availableToAdd.length || settings.pending}
            onClick={() => setAdding(true)}
          >
            Add source
          </Button>
        </SectionToolbar>
        {accounts.data && (
          <AssistantApps
            organizationId={organization.id}
            search={search}
            data={accounts.data}
            policies={policies.error ? undefined : policies.data}
          />
        )}
        {/* Two reads settle this list together, and the empty state depends on the search too. */}
        {settings.failure ? (
          <FailureNotice
            message={settings.failure.message}
            retrying={settings.failure.retrying}
            onRetry={settings.failure.retry}
          />
        ) : !policies.data || !secrets.data ? (
          <SectionSkeleton title='Added sources' />
        ) : added.length === 0 && !secretSource && !search && !assistantVisible ? (
          <EmptyState title='No sources yet. Add a source to get started.' />
        ) : (
          <SettingsSection title='Added sources'>
            {showSecrets && (
              <GenericSecretSourceRow organizationId={organization.id} source={secretSource} />
            )}
            {visible.map((integration) => {
              const entry = LIVE_SEARCH_SOURCE_TYPES.find(
                ([sourceType]) => sourceType === integration.connectorType
              )
              if (!entry) return null
              const [type, meta] = entry
              const serviceAccount =
                type === 'gitlab' || integration.policy?.accessMode === 'service_account'
              const memberProvider = liveSearchMemberAccountProvider(type)
              const mcpProvider = liveSearchMcpConnector(type)
              const group = accounts.data?.credentialGroup
              const slackOption = group?.options.find((option) => option.provider === 'slack')
              const needsSlackSetup =
                type === 'slack' &&
                accounts.data &&
                (group?.status !== 'active' ||
                  slackOption?.status !== 'active' ||
                  slackOption.configurationStatus !== 'ready' ||
                  !hasSlackSearchUserScopes(slackOption.requiredScopes))
              const needsMemberSetup =
                integration.available !== false &&
                accounts.data &&
                (memberProvider || mcpProvider) &&
                (group?.status !== 'active' ||
                  (mcpProvider
                    ? !group.mcpServers.some(
                        (server) => server.managedConnectorId === mcpProvider && server.enabled
                      )
                    : !group.options.some(
                        (option) =>
                          option.provider === memberProvider &&
                          option.status === 'active' &&
                          option.configurationStatus === 'ready'
                      )))
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
                <SettingsRow
                  key={type}
                  label={meta.name}
                  leading={<IntegrationMark providerId={type} icon={meta.icon} />}
                  description={
                    integration.available === false
                      ? 'Currently unavailable'
                      : needsSlackSetup
                        ? 'Member accounts · Verify Search permissions'
                        : scope
                  }
                >
                  <ActionRow>
                    {serviceAccount && (
                      <Button size='compact' render={<Link href={routes.searchProvider(type)} />}>
                        {type === 'gitlab'
                          ? 'Projects'
                          : type === 'github'
                            ? 'Repositories'
                            : 'Connections'}
                      </Button>
                    )}
                    {type === 'slack' && (
                      <Button size='compact' onClick={() => void setConnectedAccounts('slack')}>
                        {needsSlackSetup ? 'Verify permissions' : 'Slack app'}
                      </Button>
                    )}
                    {needsMemberSetup && (
                      <Button
                        size='compact'
                        disabled={settings.pending}
                        onClick={() =>
                          settings.setUpAccounts(
                            type,
                            integration.policy ?? defaultLiveSearchPolicy(type)
                          )
                        }
                      >
                        Set up accounts
                      </Button>
                    )}
                    {LIVE_SEARCH_SERVICE_PROVIDERS.includes(type) && type !== 'gitlab' && (
                      <Button size='compact' onClick={() => setEditing(integration)}>
                        Configure
                      </Button>
                    )}
                    <ActionMenu
                      label={`${meta.name} source actions`}
                      icon='I108'
                      actions={[
                        {
                          id: 'remove',
                          label: 'Remove source',
                          destructive: true,
                          disabled: settings.pending,
                          onSelect: () => setRemoving(type),
                        },
                      ]}
                    />
                  </ActionRow>
                </SettingsRow>
              )
            })}
            {search && visible.length === 0 && !showSecrets && !assistantVisible && (
              <EmptyState title='No matching sources' />
            )}
          </SettingsSection>
        )}
        {editing && (
          <PolicyModal
            key={editing.connectorType}
            organizationId={organization.id}
            integration={editing}
            onClose={() => setEditing(null)}
          />
        )}
        <SlackAccountSetup organizationId={organization.id} isAdmin={viewer.isAdmin} />
        {addingSecrets && (
          <GenericSecretSourceModal
            organizationId={organization.id}
            source={null}
            onClose={() => setAddingSecrets(false)}
          />
        )}
        {removing !== null && (
          <ConfirmDialog
            target
            onClose={() => setRemoving(null)}
            title={`Remove ${removingName} source?`}
            confirmLabel='Remove source'
            pendingLabel='Removing…'
            onConfirm={() => settings.removeSource(removing)}
          >
            <Muted>Members will no longer be able to search this source.</Muted>
          </ConfirmDialog>
        )}
        {adding && (
          <AddSourceModal
            sources={availableToAdd}
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
            pending={settings.pending}
            ready={availability.isIntegrationAvailabilityReady}
            feedback={
              accounts.error ? (
                <FailureNotice
                  message={getErrorMessage(accounts.error, 'Could not check account availability')}
                  retrying={accounts.isFetching}
                  onRetry={() => void accounts.refetch()}
                />
              ) : null
            }
            onClose={() => setAdding(false)}
            onSelect={(type, mode) => {
              if (type === GENERIC_SECRETS_SOURCE_TYPE) {
                setAdding(false)
                setAddingSecrets(true)
                return
              }
              if (type === 'gitlab' || !LIVE_SEARCH_SERVICE_PROVIDERS.includes(type)) {
                settings.addSource(type, () => {
                  setAdding(false)
                  if (type === 'gitlab') router.push(routes.searchProvider(type))
                  if (type === 'slack') void setConnectedAccounts('slack')
                })
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
      </SectionStack>
    </SourceSetup>
  )
}
