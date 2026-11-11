'use client'

import { useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { AddSourceModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/add-source-modal'
import { AssistantApps } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/assistant-apps'
import {
  GENERIC_SECRETS_NAME,
  GENERIC_SECRETS_SOURCE_TYPE,
  GenericSecretSourceModal,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/generic-secrets'
import {
  sourceScope,
  sourceTypeMeta,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/model'
import { PolicyModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/policy-modal'
import { SourceSetup } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/source-setup-host'
import {
  type SourceListRow,
  type SourceRowAction,
  SourcesList,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/sources-list'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  defaultLiveSearchPolicy,
  getLiveSearchAccessAvailability,
  hasSlackSearchUserScopes,
  LIVE_SEARCH_SCOPE_FIELDS,
  LIVE_SEARCH_SERVICE_PROVIDERS,
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
  type SearchIntegrationApproval,
  type SearchIntegrationStatus,
  useGenericSecretSourceRemoval,
  useSearchAvailability,
  useSettingsSearch,
  useSourceSettings,
} from '@/platform/lib/data/search-sources'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

/**
 * The organization's Search sources on live data: Assistant apps, each added source with its
 * connections, account setup, policy and removal, the Generic Secrets source, and adding a source.
 */
export function LiveSources() {
  const { organization, viewer, searchAccess } = useOrganization()
  const surface = useSurfaceScope()
  const settings = useSourceSettings(organization.id, viewer.isAdmin)
  const { policies, secrets, accounts, added } = settings
  const availability = useSearchAvailability()
  const router = useRouter()
  const [search, setSearch] = useSettingsSearch()
  const [editing, setEditing] = useState<SearchIntegrationApproval | null>(null)
  const [configuringSecrets, setConfiguringSecrets] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addingSecrets, setAddingSecrets] = useState(false)
  const providerHref = (type: string) =>
    surfaceHref(surface, `/settings/integrations/providers/${encodeURIComponent(type)}`)
  const slackHref = surfaceHref(surface, '/settings/search-slack')

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
            availabilityStatus: undefined,
            access: { admin: true, members: true },
          },
        ]
      : []),
  ]
  const removeSecrets = useGenericSecretSourceRemoval(organization.id)

  function sourceRow(integration: SearchIntegrationStatus): SourceListRow | null {
    const entry = LIVE_SEARCH_SOURCE_TYPES.find(
      ([sourceType]) => sourceType === integration.connectorType
    )
    if (!entry) return null
    const [type, typeInfo] = entry
    const meta = sourceTypeMeta(type)
    const serviceAccount =
      meta.serviceAccountOnly || integration.policy?.accessMode === 'service_account'
    const memberProvider = liveSearchMemberAccountProvider(type)
    const mcpProvider = liveSearchMcpConnector(type)
    const group = accounts.data?.credentialGroup
    const slackOption = group?.options.find((option) => option.provider === 'slack')
    const needsSlackSetup =
      meta.slackApp &&
      accounts.data !== undefined &&
      (group?.status !== 'active' ||
        slackOption?.status !== 'active' ||
        slackOption.configurationStatus !== 'ready' ||
        !hasSlackSearchUserScopes(slackOption.requiredScopes))
    const needsMemberSetup =
      integration.available !== false &&
      accounts.data !== undefined &&
      Boolean(memberProvider || mcpProvider) &&
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
    const actions: SourceRowAction[] = [
      ...(needsSlackSetup ? [{ label: 'Verify permissions', href: slackHref }] : []),
      ...(needsMemberSetup
        ? [
            {
              label: 'Set up accounts',
              disabled: settings.pending,
              onSelect: () =>
                settings.setUpAccounts(type, integration.policy ?? defaultLiveSearchPolicy(type)),
            },
          ]
        : []),
      ...(serviceAccount ? [{ label: meta.connections, href: providerHref(type) }] : []),
      ...(meta.slackApp && !needsSlackSetup ? [{ label: 'Slack app', href: slackHref }] : []),
      ...(LIVE_SEARCH_SERVICE_PROVIDERS.includes(type) && !meta.serviceAccountOnly
        ? [{ label: 'Configure', onSelect: () => setEditing(integration) }]
        : []),
    ]
    const [primary, ...more] = actions
    return {
      id: type,
      name: typeInfo.name,
      leading: <Icon providerId={type} />,
      description:
        integration.available === false
          ? 'Currently unavailable'
          : needsSlackSetup
            ? 'Member accounts · Verify Search permissions'
            : sourceScope(type, serviceAccount, Boolean(integration.policy?.sourceId)),
      primary,
      more,
      removeConsequence: 'Members can no longer search this source',
      removeDisabled: settings.pending,
      onRemove: () => settings.removeSource(type),
    }
  }

  const secretsRow: SourceListRow | null =
    showSecrets && secretSource
      ? {
          id: GENERIC_SECRETS_SOURCE_TYPE,
          name: GENERIC_SECRETS_NAME,
          leading: <Icon name='I070' />,
          description: secretSource.mode === 'organization' ? 'Organization' : 'Member',
          primary:
            secretSource.mode === 'organization'
              ? { label: 'Secrets', href: surfaceHref(surface, '/settings/integrations/secrets') }
              : { label: 'Configure', onSelect: () => setConfiguringSecrets(true) },
          more:
            secretSource.mode === 'organization'
              ? [{ label: 'Configure', onSelect: () => setConfiguringSecrets(true) }]
              : [],
          removeConsequence: 'Its organization and member secrets are deleted',
          onRemove: () => removeSecrets(secretSource.id),
        }
      : null
  const rows =
    !policies.data || !secrets.data
      ? null
      : [
          ...visible.flatMap((integration) => sourceRow(integration) ?? []),
          ...(secretsRow ? [secretsRow] : []),
        ]

  return (
    <SourceSetup
      scope={{ kind: 'organization', organizationId: organization.id }}
      backLabel='Sources'
      canAdmin={viewer.isAdmin}
      memberAccessAvailable={searchAccess.memberScoped}
      mirroredAccessAvailable={searchAccess.sourceMirrored}
    >
      <SourcesList
        search={search}
        onSearchChange={setSearch}
        assistantApps={
          accounts.data && (
            <AssistantApps
              organizationId={organization.id}
              search={search}
              data={accounts.data}
              policies={policies.error ? undefined : policies.data}
            />
          )
        }
        rows={rows}
        failure={
          settings.failure && (
            <FailureNotice
              message={settings.failure.message}
              retrying={settings.failure.retrying}
              onRetry={settings.failure.retry}
            />
          )
        }
        searchable={added.length > 0 || Boolean(secretSource) || search !== ''}
        addDisabled={!availableToAdd.length || settings.pending}
        onAdd={() => setAdding(true)}
      >
        {editing && (
          <PolicyModal
            key={editing.connectorType}
            organizationId={organization.id}
            integration={editing}
            onClose={() => setEditing(null)}
          />
        )}
        {addingSecrets && (
          <GenericSecretSourceModal
            organizationId={organization.id}
            source={null}
            onClose={() => setAddingSecrets(false)}
          />
        )}
        {configuringSecrets && secretSource && (
          <GenericSecretSourceModal
            organizationId={organization.id}
            source={secretSource}
            onClose={() => setConfiguringSecrets(false)}
          />
        )}
        {adding && (
          <AddSourceModal
            sources={availableToAdd}
            descriptions={Object.fromEntries(
              availableToAdd.map(({ type, access }) => [
                type,
                type === GENERIC_SECRETS_SOURCE_TYPE
                  ? 'Organization or member secrets'
                  : sourceTypeMeta(type).serviceScope !== 'Service account'
                    ? sourceTypeMeta(type).serviceScope
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
              const meta = sourceTypeMeta(type)
              if (meta.serviceAccountOnly || !LIVE_SEARCH_SERVICE_PROVIDERS.includes(type)) {
                settings.addSource(type, () => {
                  setAdding(false)
                  if (meta.serviceAccountOnly) router.push(providerHref(type))
                  if (meta.slackApp) router.push(slackHref)
                })
                return
              }
              setAdding(false)
              setEditing({
                connectorType: type,
                approved: false,
                policy: {
                  ...defaultLiveSearchPolicy(type),
                  accessMode:
                    mode === 'admin' || sourceTypeMeta(type).appInstallation
                      ? 'service_account'
                      : 'member',
                },
              })
            }}
          />
        )}
      </SourcesList>
    </SourceSetup>
  )
}
