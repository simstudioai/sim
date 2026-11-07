'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import type {
  OrganizationAccountsSettings,
  OrganizationAccountWorkspaceAccess,
} from '@/lib/api/contracts/organization-accounts'
import {
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  type SlackManagedUsersSetupOptions,
  useSlackManagedUsersSetup,
} from '@/ee/credential-groups/hooks/use-slack-managed-users-setup'
import type { OrganizationAccountProviderChoice } from '@/ee/credential-groups/provider-rows'
import { credentialGroupWorkspaceSearchParam } from '@/ee/credential-groups/search-params'
import {
  useAddOrganizationAccountMcpProvider,
  useConfigureOrganizationMcp,
  useEnsureOrganizationAccounts,
  useInviteOrganizationAccountPeople,
  useOrganizationAccountPeople,
  useOrganizationAccounts,
  useOrganizationAccountWorkspaceAccess,
  useOrganizationDatabricksSetup,
  useRemoveOrganizationAccountMcpProvider,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
  useUpdateOrganizationAccounts,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/hooks/queries/organization-accounts'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useOrganizationAccountPeopleSearch } from '@/hooks/use-organization-account-people-search'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { toast } from '@/platform/shared/toast'

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
