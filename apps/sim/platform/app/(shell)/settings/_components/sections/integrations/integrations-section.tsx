'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import {
  ActionRow,
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { AddSourceModal } from '@/platform/app/(shell)/settings/_components/sections/integrations/add-source-modal'
import { AssistantApps } from '@/platform/app/(shell)/settings/_components/sections/integrations/assistant-apps'
import {
  GENERIC_SECRETS_NAME,
  GENERIC_SECRETS_SOURCE_TYPE,
  GenericSecretSourceModal,
  GenericSecretSourceRow,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/generic-secrets'
import { PolicyModal } from '@/platform/app/(shell)/settings/_components/sections/integrations/policy-modal'
import { SlackAccountSetup } from '@/platform/app/(shell)/settings/_components/sections/integrations/slack-account-setup'
import { SourceSetup } from '@/platform/app/(shell)/settings/_components/sections/integrations/source-setup-host'
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  EmptyState,
  FailureNotice,
  LoadingRows,
  SectionSearch,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  assistantAccountOptions,
  connectedAccountsParam,
  defaultLiveSearchPolicy,
  getLiveSearchAccessAvailability,
  hasSlackSearchUserScopes,
  LIVE_SEARCH_SCOPE_FIELDS,
  LIVE_SEARCH_SERVICE_PROVIDERS,
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
  organizationRoutes,
  type SearchIntegrationApproval,
  useOrganizationAccounts,
  useOrganizationSecretSource,
  usePermissionConfig,
  useSearchIntegrations,
  useSettingsSearch,
  useUpdateSearchIntegration,
} from '@/platform/lib/data/sources'

export default function IntegrationsSection({ organization: context }: SettingsSectionProps) {
  const { organization, viewer, searchAccess } = context
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
            disabled={!policies.data || !secrets.data || !availableToAdd.length || update.isPending}
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
        {policies.error || secrets.error ? (
          <FailureNotice
            message={getErrorMessage(policies.error ?? secrets.error, 'Could not load sources')}
            retrying={policies.isFetching || secrets.isFetching}
            onRetry={() => {
              void policies.refetch()
              void secrets.refetch()
            }}
          />
        ) : !policies.data || !secrets.data ? (
          <LoadingRows label='Loading sources' />
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
                          disabled: update.isPending,
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
            onConfirm={async () => {
              try {
                await update.mutateAsync({
                  organizationId: organization.id,
                  connectorType: removing,
                  approved: false,
                })
              } catch (error) {
                toast.error(getErrorMessage(error, 'Could not remove the source'))
                return false
              }
            }}
          >
            <Muted>Members will no longer be able to search this source.</Muted>
          </ConfirmDialog>
        )}
        {adding && (
          <AddSourceModal
            organization={organization}
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
            pending={update.isPending}
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
      </SectionStack>
    </SourceSetup>
  )
}
