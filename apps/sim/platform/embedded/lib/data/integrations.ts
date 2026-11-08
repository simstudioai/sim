import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import type { UpdateSearchIntegrationBody } from '@/lib/api/contracts/knowledge/search-integrations'
import type {
  OrganizationAccountsSettings,
  OrganizationAccountWorkspaceAccess,
} from '@/lib/api/contracts/organization-accounts'
import type { SaveSearchPersonalCredentialBody } from '@/lib/api/contracts/search-personal-credentials'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import {
  type CredentialGroupProvider,
  type CredentialGroupStandardOAuthProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SCOPE_FIELDS,
} from '@/lib/sim-search/live/policy-schema'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  type SlackManagedUsersSetupOptions,
  useSlackManagedUsersSetup,
} from '@/ee/credential-groups/hooks/use-slack-managed-users-setup'
import type { OrganizationAccountProviderChoice } from '@/ee/credential-groups/provider-rows'
import { credentialGroupWorkspaceSearchParam } from '@/ee/credential-groups/search-params'
import {
  useAssistantToolPermissions,
  useUpdateAssistantToolPermissions,
} from '@/hooks/queries/assistant-actions'
import {
  isConnectorSyncingOrPending,
  useConnectorDetail,
  useSearchIndex,
  useSearchSources,
} from '@/hooks/queries/kb/connectors'
import {
  useAddOrganizationAccountMcpProvider,
  useConfigureOrganizationMcp,
  useConnectOrganizationAccount,
  useDisconnectPersonalOrganizationAccount,
  useEnsureOrganizationAccounts,
  useInviteOrganizationAccountPeople,
  useOrganizationAccountPeople,
  useOrganizationAccounts,
  useOrganizationAccountWorkspaceAccess,
  useOrganizationDatabricksSetup,
  useReconnectPersonalOrganizationAccount,
  useRemoveOrganizationAccountMcpProvider,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
  useUpdateOrganizationAccounts,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationSecretSource } from '@/hooks/queries/organization-secrets'
import { useRemovePersonalSearchCredential } from '@/hooks/queries/personal-search-integrations'
import {
  useSearchIntegrations,
  useUpdateSearchIntegration,
} from '@/hooks/queries/search-integrations'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useOrganizationAccountPeopleSearch } from '@/hooks/use-organization-account-people-search'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import {
  toGenericSecrets,
  toOrganizationIntegrations,
  toToolPermissions,
} from '@/platform/embedded/lib/data/integrations-model'
import { usePlatformNotices } from '@/platform/embedded/lib/notices'
import type { OrganizationIntegration, ToolPermissionChange } from '@/platform/shared/integrations'
import { toast } from '@/platform/shared/toast'

const ACTION_NOTICE_ID = 'integrations-action'

function useActionFailureNotice() {
  const notices = usePlatformNotices()
  return (error: unknown) =>
    notices.notify({
      id: ACTION_NOTICE_ID,
      title: getErrorMessage(error, 'That did not work. Try again.'),
      variant: 'error',
    })
}

/** The member inventory and its reads, each failing and retrying on its own. */
export function useMemberIntegrations(organizationId: string) {
  const inventory = useOrganizationAccounts(organizationId)
  const policies = useSearchIntegrations(organizationId)
  const secrets = useOrganizationSecretSource(organizationId)
  return {
    integrations: inventory.data
      ? toOrganizationIntegrations(inventory.data, policies.isSuccess ? policies.data : undefined)
      : [],
    genericSecrets: toGenericSecrets(secrets.data?.source),
    inventory,
    policies,
    secrets,
  }
}

export function useIntegrationActions(organizationId: string) {
  const [savedConnection, setSavedConnection] = useState<{
    providerId: SaveSearchPersonalCredentialBody['providerId']
    credentialId?: string
    displayName?: string
  } | null>(null)
  const inventory = useOrganizationAccounts(organizationId)
  const savedAccounts = inventory.data?.viewerSavedAccounts ?? []
  const removeSaved = useRemovePersonalSearchCredential()
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const onError = useActionFailureNotice()
  const connecting = connect.isPending || reconnect.isPending
  const closeSavedConnection = useCallback(() => setSavedConnection(null), [])
  return {
    connecting,
    pending: connecting || disconnect.isPending || removeSaved.isPending,
    savedConnection,
    closeSavedConnection,
    connect: (
      target: NonNullable<OrganizationIntegration['connectionTarget']>,
      onConnected?: () => void
    ) => {
      if ('savedProviderId' in target) setSavedConnection({ providerId: target.savedProviderId })
      else
        connect.mutate(
          { organizationId, ...target },
          { onError, onSuccess: (connected) => connected && onConnected?.() }
        )
    },
    reconnect: (credentialId: string, onConnected?: () => void) => {
      const saved = savedAccounts.find((account) => account.credentialId === credentialId)
      if (saved)
        setSavedConnection({
          providerId: saved.providerId,
          credentialId,
          displayName: saved.displayName,
        })
      else
        reconnect.mutate(credentialId, {
          onError,
          onSuccess: (connected) => connected && onConnected?.(),
        })
    },
    disconnect: async (credentialId: string) => {
      if (savedAccounts.some((account) => account.credentialId === credentialId))
        await removeSaved.mutateAsync({ organizationId, credentialId })
      else await disconnect.mutateAsync({ credentialId, organizationId })
    },
  }
}

export function useToolPermissions(organizationId: string, credentialId: string) {
  const query = useAssistantToolPermissions(organizationId, credentialId)
  const update = useUpdateAssistantToolPermissions(organizationId, credentialId)
  const onError = useActionFailureNotice()
  const data = query.data
  const display = data && resolveCredentialDisplay({ ...data.account, type: 'managed_oauth' })
  return {
    query,
    pending: update.isPending,
    view: data &&
      display && {
        permissions: toToolPermissions(data),
        heading: {
          name: display.detailTitle || data.account.providerId,
          account: data.account.displayName,
          icon: display.icon ?? undefined,
        },
      },
    save(change: ToolPermissionChange) {
      if (!data || update.isPending) return
      update.mutate({ revision: data.revision, change }, { onError })
    },
  }
}

type CredentialGroup = NonNullable<OrganizationAccountsSettings['credentialGroup']>

/**
 * The organization's credential-group settings and the one-time setup that creates the group. A
 * failed read or setup is one notice whose retry clears the setup and rereads.
 */
export function useCredentialGroupSettings(organizationId: string) {
  const accounts = useOrganizationAccounts(organizationId)
  const ensure = useEnsureOrganizationAccounts()
  const error = accounts.error ?? ensure.error
  return {
    settings: accounts.data,
    failure: error
      ? {
          message: getErrorMessage(error, 'Could not load credential groups'),
          retrying: accounts.isFetching || ensure.isPending,
          retry: () => {
            ensure.reset()
            void accounts.refetch()
          },
        }
      : null,
    setUpPending: ensure.isPending,
    setUp: () => ensure.mutate({ organizationId }),
  }
}

/**
 * The group's providers and the edits to them, each reporting its own success. Databricks and Slack
 * are added through their own setup dialogs, so the plain adds exclude them.
 */
export function useCredentialGroupProviders(organizationId: string, group: CredentialGroup) {
  const update = useUpdateOrganizationAccounts()
  const addMcp = useAddOrganizationAccountMcpProvider()
  const removeMcp = useRemoveOrganizationAccountMcpProvider()
  const pending = update.isPending || addMcp.isPending || removeMcp.isPending
  const options = getOrganizationAccountUpdateOptions(group)
  return {
    pending,
    error: update.error ?? addMcp.error ?? removeMcp.error,
    canUpdateConfigurations: options.length > 0,
    reset: () => {
      update.reset()
      addMcp.reset()
      removeMcp.reset()
    },
    updateConfigurations: () => {
      if (pending) return
      update.mutate(
        { organizationId, groupId: group.id, update: { options } },
        {
          onSuccess: () => toast.success('Provider configurations updated'),
          onError: (failure) => toast.error(failure.message),
        }
      )
    },
    addMcpConnector: (
      connectorId: Exclude<ManagedMcpConnectorId, 'databricks'>,
      onAdded: () => void
    ) =>
      addMcp.mutate(
        { organizationId, connectorId },
        {
          onSuccess: () => {
            onAdded()
            toast.success(`${MANAGED_MCP_CONNECTORS[connectorId].name} added`)
          },
        }
      ),
    addOAuthProvider: (
      provider: Exclude<CredentialGroupProvider, 'slack'>,
      onAdded: () => void
    ) => {
      const service = getCredentialGroupProviderService(provider)
      update.mutate(
        {
          organizationId,
          groupId: group.id,
          update: { options: [...options, { provider, label: service.name, required: false }] },
        },
        {
          onSuccess: () => {
            onAdded()
            toast.success(`${service.name} added`)
          },
        }
      )
    },
    remove: async (choice: OrganizationAccountProviderChoice) => {
      if (choice.kind === 'mcp')
        await removeMcp.mutateAsync({ organizationId, connectorId: choice.connectorId })
      else
        await update.mutateAsync({
          organizationId,
          groupId: group.id,
          update: { options: options.filter((option) => option.provider !== choice.provider) },
        })
      toast.success('Provider removed')
    },
  }
}

interface DatabricksConfiguration {
  name: string
  url: string
  oauthClientId: string
  oauthClientSecret?: string
}

/**
 * Adds the Databricks connector, or edits the existing server read back for the form. The stored
 * client secret is never returned: only whether one exists.
 */
export function useDatabricksConfiguration(
  organizationId: string,
  existingServer: CredentialGroup['mcpServers'][number] | undefined
) {
  const setup = useOrganizationDatabricksSetup(organizationId, Boolean(existingServer))
  const add = useAddOrganizationAccountMcpProvider()
  const configure = useConfigureOrganizationMcp()
  const server = existingServer ? setup.data?.server : undefined
  const setupError = existingServer ? setup.error : null
  const error = add.error ?? configure.error ?? setupError
  const adding = !existingServer?.enabled
  return {
    adding,
    server,
    loading: Boolean(existingServer) && setup.isPending,
    fieldsAvailable: !existingServer || Boolean(server && !setupError),
    pending: configure.isPending || add.isPending,
    error: error ? getErrorMessage(error, 'Could not save Databricks') : null,
    /** Resolves to `false` when the save failed, so the dialog stays open. */
    save: async (fields: DatabricksConfiguration) => {
      try {
        const configuration = { organizationId, ...fields }
        if (existingServer) await configure.mutateAsync(configuration)
        else await add.mutateAsync({ ...configuration, connectorId: 'databricks' })
        toast.success(adding ? 'Databricks added' : 'Databricks configuration saved')
      } catch (failure) {
        toast.error(getErrorMessage(failure, 'Could not save Databricks'))
        return false
      }
    },
  }
}

/** The workspace-access read and its search, kept in the URL. */
export function useCredentialGroupWorkspaceAccess(organizationId: string) {
  const access = useOrganizationAccountWorkspaceAccess(organizationId)
  const [searchTerm, setSearchParam] = useQueryState(credentialGroupWorkspaceSearchParam.key, {
    ...credentialGroupWorkspaceSearchParam.parser,
    history: 'replace',
    clearOnDefault: true,
  })
  return { access, searchTerm, setSearchTerm: useDebouncedSearchSetter(setSearchParam) }
}

/** Saves the full grant list at the revision it was edited from; `onSaved` runs before the toast. */
export function useWorkspaceAccessUpdate(organizationId: string, onSaved: () => void) {
  const update = useUpdateOrganizationAccountWorkspaceAccess()
  return {
    pending: update.isPending,
    error: update.error,
    reset: () => update.reset(),
    save: async (grants: OrganizationAccountWorkspaceAccess['grants'], revision: number) => {
      try {
        await update.mutateAsync({ organizationId, revision, grants })
        onSaved()
        toast.success('Workspace access updated')
      } catch (failure) {
        toast.error(getErrorMessage(failure, 'Could not update workspace access'))
      }
    },
  }
}

/**
 * The people asked to connect accounts, searched through the URL and paged. A failed first page
 * fails the list; a failed later page keeps the loaded rows and offers its own retry.
 */
export function useCredentialGroupPeople(organizationId: string) {
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()
  const [searchInput, setSearchInput] = useOrganizationAccountPeopleSearch()
  const search = useSearchFilterValue(searchInput, SEARCH_DEBOUNCE_MS).trim()
  const people = useOrganizationAccountPeople(organizationId, search, { enabled: true })
  const listFailed = people.error && !people.isFetchNextPageError
  return {
    searchInput,
    setSearchInput,
    search,
    list: {
      data: listFailed ? undefined : people.data,
      error: people.error,
      isFetching: people.isFetching,
      refetch: people.refetch,
    },
    enrollments: people.data?.pages.flatMap((page) => page.enrollments) ?? [],
    more: {
      available: people.hasNextPage && !people.isFetchNextPageError && !listFailed,
      loading: people.isFetchingNextPage,
      load: () => void people.fetchNextPage(),
      failure: people.isFetchNextPageError
        ? getErrorMessage(people.error, 'Could not load more people')
        : null,
    },
    pending: resend.isPending || revoke.isPending,
    error: resend.error ?? revoke.error,
    resend: (enrollmentId: string) =>
      resend.mutate(
        { organizationId, enrollmentId },
        { onSuccess: () => toast.success('Invitation sent') }
      ),
    resetRevoke: () => revoke.reset(),
    revoke: async (enrollmentId: string) => {
      await revoke.mutateAsync({ organizationId, enrollmentId })
      toast.success('Access revoked')
    },
  }
}

/** How a send went: all delivered, or the addresses that failed and the notice explaining them. */
type ConnectionRequestDelivery = { sent: true } | { sent: false; failed: string[]; notice: string }

/** Sends connection requests and reads back which addresses were delivered. */
export function useConnectionRequestInvite(organizationId: string) {
  const invite = useInviteOrganizationAccountPeople()
  return {
    pending: invite.isPending,
    error: invite.error ? getErrorMessage(invite.error, 'Failed to send invitations') : null,
    /** Resolves to `null` when the request itself failed: `error` then holds why. */
    send: async (emails: string[]): Promise<ConnectionRequestDelivery | null> => {
      try {
        const result = await invite.mutateAsync({ organizationId, emails })
        const failures = result.results.filter((item) => !item.success)
        if (failures.length === 0) {
          toast.success(
            result.sentCount === 1
              ? 'Connection request sent'
              : `${result.sentCount} connection requests sent`
          )
          return { sent: true }
        }
        return {
          sent: false,
          failed: failures.map((item) => item.email),
          notice:
            result.sentCount > 0
              ? `${result.sentCount} sent. ${failures.length} failed: ${failures.map((item) => item.email).join(', ')}`
              : `No invitations were sent: ${failures.map((item) => `${item.email} (${item.error})`).join(', ')}`,
        }
      } catch {
        return null
      }
    },
  }
}

type SlackMemberSetupOptions = Pick<
  SlackManagedUsersSetupOptions,
  'credentialGroupId' | 'initialCredentialId' | 'initialRequiredScopes' | 'onOpenChange'
> & { organizationId: string }

/**
 * Member Slack access for the organization's Sim Search app, always open and with no workspace
 * bots to choose from. `dismissOnly` is a shared app that needs nothing more.
 */
export function useSlackMemberSetup(options: SlackMemberSetupOptions) {
  const setup = useSlackManagedUsersSetup({
    ...options,
    open: true,
    bots: [],
    isLoading: false,
  })
  const { apps, failedSetup, selectedApp } = setup
  return {
    appSetupOpen: setup.appSetupOpen,
    setAppSetupOpen: setup.setAppSetupOpen,
    hidden: setup.sharedAppReady && !setup.appSetupOpen,
    dismissOnly: setup.sharedAppInstalled && !setup.sharedAppNeedsUpdate,
    title: setup.title,
    checkingSetup: setup.checkingSetup,
    failure: failedSetup
      ? {
          message: failedSetup.error?.message ?? 'Could not check the Slack app',
          retrying: failedSetup.isFetching,
          retry: () => void failedSetup.refetch(),
        }
      : null,
    sharedAppWithoutBot: setup.sharedAppWithoutBot,
    memberAccountsCopy: setup.memberAccountsCopy,
    needsApp: setup.needsApp,
    pending: setup.pending,
    primaryDisabled: setup.primaryDisabled,
    primaryLabel: setup.primaryLabel,
    handleOpenChange: setup.handleOpenChange,
    handleSubmit: setup.handleSubmit,
    appOptions: setup.availableApps.map((app) => ({ value: app.appId, label: app.teamName })),
    selectedApp,
    setAppId: setup.setAppId,
    selectedBotName: apps.data?.bots.find((bot) => bot.id === selectedApp?.credentialId)
      ?.displayName,
  }
}

type SearchPolicy = NonNullable<UpdateSearchIntegrationBody['policy']>

const ACCESS_FAILURE = [401, 403, 404]

function isAccessFailure(error: unknown) {
  return isApiClientError(error) && ACCESS_FAILURE.includes(error.status)
}

/**
 * The Sources section: its added integrations, the Generic Secrets source, the admin's account
 * inventory, and the approvals it changes. The two reads that settle the list fail together.
 */
export function useSourceSettings(organizationId: string, isAdmin: boolean) {
  const policies = useSearchIntegrations(organizationId)
  const secrets = useOrganizationSecretSource(organizationId)
  const accounts = useOrganizationAccounts(isAdmin ? organizationId : undefined)
  const update = useUpdateSearchIntegration()
  const approve = (connectorType: string, policy: SearchPolicy, onApproved: () => void) =>
    update.mutate(
      { organizationId, connectorType, approved: true, policy },
      { onSuccess: () => onApproved(), onError: (error) => toast.error(error.message) }
    )
  return {
    policies,
    secrets,
    accounts,
    added:
      policies.data?.filter((row) => row.approved && LIVE_SEARCH_SCOPE_FIELDS[row.connectorType]) ??
      [],
    failure:
      policies.error || secrets.error
        ? {
            message: getErrorMessage(policies.error ?? secrets.error, 'Could not load sources'),
            retrying: policies.isFetching || secrets.isFetching,
            retry: () => {
              void policies.refetch()
              void secrets.refetch()
            },
          }
        : null,
    pending: update.isPending,
    setUpAccounts: (connectorType: string, policy: SearchPolicy) =>
      approve(connectorType, policy, () => toast.success('Source settings saved')),
    addSource: (connectorType: string, onAdded: () => void) =>
      approve(connectorType, defaultLiveSearchPolicy(connectorType), onAdded),
    removeSource: async (connectorType: string) => {
      try {
        await update.mutateAsync({ organizationId, connectorType, approved: false })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not remove the source'))
        return false
      }
    },
  }
}

/** Saves an integration's Search policy, keeping the failure on the form instead of a toast. */
export function useSearchPolicySave(organizationId: string) {
  const update = useUpdateSearchIntegration()
  return {
    pending: update.isPending,
    error: update.error?.message,
    save: async (connectorType: string, policy: SearchPolicy) => {
      try {
        await update.mutateAsync({ organizationId, connectorType, approved: true, policy })
        return true
      } catch {
        return false
      }
    },
  }
}

/** One provider's service-account connections, as options that only a usable connection enables. */
export function useServiceAccountConnections(organizationId: string, provider: string) {
  const sources = useSearchSources(
    { kind: 'organization', organizationId },
    { connectorType: provider }
  )
  return {
    sources,
    options: (sources.data ?? [])
      .filter((source) => source.accessMode === 'admin')
      .map((source) => ({
        value: source.connectorId,
        label: `${source.sourceDescription || connectorDisplayName(provider)}${
          !source.enabled
            ? ' · Paused'
            : source.availability !== 'available'
              ? ' · Unavailable'
              : ''
        }`,
        disabled: !source.enabled || source.availability !== 'available',
      })),
  }
}

/**
 * One provider's approval, the connections an admin manages for it, and, for Slack, the app setup
 * the organization's accounts group holds.
 */
export function useProviderConnections(
  organizationId: string,
  connectorType: string,
  { search, isAdmin }: { search: string; isAdmin: boolean }
) {
  const overview = useSearchIntegrations(organizationId)
  const sources = useSearchSources(
    { kind: 'organization', organizationId },
    { connectorType, search, enabled: isAdmin }
  )
  const accounts = useOrganizationAccounts(
    isAdmin && connectorType === 'slack' ? organizationId : undefined
  )
  const removeSlackAccounts = useUpdateOrganizationAccounts()
  const group = accounts.data?.credentialGroup
  const slackOption = group?.options.find(
    (item) => item.provider === 'slack' && item.status === 'active'
  )
  return {
    overview,
    sources,
    accounts,
    provider: overview.data?.find((item) => item.connectorType === connectorType),
    listed: sources.data?.filter(
      (source) =>
        source.accessMode === 'admin' || (connectorType === 'github' && source.isGitHubInstallation)
    ),
    needsSlackSetup:
      connectorType === 'slack' &&
      (slackOption?.provider !== 'slack' || slackOption.configurationStatus !== 'ready'),
    canRemoveSlackSetup:
      connectorType === 'slack' &&
      !accounts.isError &&
      group?.options.some((item) => item.provider === 'slack'),
    resetSlackRemoval: removeSlackAccounts.reset,
    /** Drops the Slack option from the accounts group, which disconnects its accounts. */
    removeSlackSetup: group
      ? async () => {
          await removeSlackAccounts.mutateAsync({
            organizationId,
            groupId: group.id,
            update: {
              options: group.options
                .filter((item) => item.provider !== 'slack')
                .map(({ id, provider, label, required }) => ({ id, provider, label, required })),
            },
          })
        }
      : undefined,
  }
}

/**
 * The organization's Slack app setup while its modal is open. The accounts group is prepared once
 * when the read finds none, and `failure` retries whichever step failed.
 */
export function useSlackAppSetup(organizationId: string, open: boolean) {
  const accounts = useOrganizationAccounts(open ? organizationId : undefined)
  const {
    mutate: ensureAccounts,
    data: preparedAccounts,
    error: setupError,
    isIdle: setupIdle,
    isPending: setupPending,
  } = useEnsureOrganizationAccounts()
  const prepared = preparedAccounts?.credentialGroup
  const group =
    accounts.data?.credentialGroup ??
    (prepared?.organizationId === organizationId ? prepared : undefined)
  const needsSetup = open && accounts.isSuccess && !group
  useEffect(() => {
    if (needsSetup && setupIdle) ensureAccounts({ organizationId })
  }, [ensureAccounts, needsSetup, setupIdle, organizationId])
  const error = accounts.error ?? setupError
  return {
    group,
    failure: error
      ? {
          message: getErrorMessage(error, 'Could not load Slack setup'),
          retrying: accounts.isFetching || setupPending,
          retry: () =>
            accounts.error ? void accounts.refetch() : ensureAccounts({ organizationId }),
        }
      : null,
  }
}

/** Connects, reconnects, and adds Assistant apps, toasting each failure. */
export function useAssistantAppActions(organizationId: string) {
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const ensure = useEnsureOrganizationAccounts()
  const onError = (error: Error) => toast.error(error.message)
  return {
    connectionPending: connect.isPending || reconnect.isPending,
    connectingOptionId:
      connect.isPending && 'optionId' in connect.variables ? connect.variables.optionId : null,
    adding: ensure.isPending,
    connect: (optionId: string) => connect.mutate({ organizationId, optionId }, { onError }),
    reconnect: (credentialId: string) => reconnect.mutate(credentialId, { onError }),
    add: (provider: CredentialGroupStandardOAuthProvider) =>
      ensure.mutate(
        {
          organizationId,
          option: {
            provider,
            label: getCredentialGroupProviderService(provider).name,
            required: false,
          },
        },
        { onError }
      ),
  }
}

/** Disconnects one of the viewer's own accounts from the organization. */
export function usePersonalAccountDisconnect(organizationId: string) {
  const disconnect = useDisconnectPersonalOrganizationAccount()
  return {
    pending: disconnect.isPending,
    reset: disconnect.reset,
    disconnect: async (credentialId: string) => {
      await disconnect.mutateAsync({ credentialId, organizationId })
    },
  }
}

/**
 * The Search index connection a URL names. `connector` is set only once the detail read matches
 * this connection in this index, so a kept previous read never shows. `failure` blocks the page
 * when nothing canonical loaded or access was refused; otherwise it only reports a failed refresh.
 */
export function useSourceConnection(scope: ResourceScope, connectorId: string, isAdmin: boolean) {
  const index = useSearchIndex(scope, { enabled: isAdmin })
  const knowledgeBaseId = isAdmin ? (index.data?.knowledgeBaseId ?? undefined) : undefined
  const detail = useConnectorDetail(knowledgeBaseId, connectorId)
  const accessFailure = [index, detail].find(
    (query) => query.isError && isAccessFailure(query.error)
  )
  const failedQuery = accessFailure ?? (index.isError ? index : detail.isError ? detail : null)
  const connector =
    detail.data &&
    !detail.isPlaceholderData &&
    detail.data.id === connectorId &&
    detail.data.knowledgeBaseId === knowledgeBaseId
      ? detail.data
      : undefined
  return {
    knowledgeBaseId,
    indexPending: index.isPending,
    connector,
    syncing: connector ? isConnectorSyncingOrPending(connector) : false,
    failure: failedQuery && {
      error: failedQuery.error,
      gone: isApiClientError(failedQuery.error) && failedQuery.error.status === 404,
      blocking: !connector || Boolean(accessFailure),
      retrying: failedQuery.isFetching,
      retry: () => void failedQuery.refetch(),
    },
  }
}

/** Whether a connection's integration is approved, and whether reading that refused access. */
export function useSourceIntegrationStatus(organizationId: string, connectorType: string) {
  const integrations = useSearchIntegrations(organizationId)
  return {
    pending: integrations.isPending,
    accessDenied: integrations.isError && isAccessFailure(integrations.error),
    deactivated:
      integrations.data?.find((item) => item.connectorType === connectorType)?.approved === false,
    failure: integrations.isError
      ? {
          message: getErrorMessage(integrations.error, 'Could not load integration status'),
          retrying: integrations.isFetching,
          retry: () => void integrations.refetch(),
        }
      : null,
  }
}
