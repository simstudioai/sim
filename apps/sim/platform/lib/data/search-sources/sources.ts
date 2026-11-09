'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import type { UpdateSearchIntegrationBody } from '@/lib/api/contracts/knowledge/search-integrations'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  type CredentialGroupStandardOAuthProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SCOPE_FIELDS,
} from '@/lib/sim-search/live/policy-schema'
import { toast } from '@/lib/toast/sink'
import {
  isConnectorSyncingOrPending,
  useConnectorDetail,
  useSearchIndex,
  useSearchSources,
} from '@/hooks/queries/kb/connectors'
import {
  useConnectOrganizationAccount,
  useDisconnectPersonalOrganizationAccount,
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
import {
  useConfigureOrganizationSecretSource,
  useOrganizationSecretSource,
  useRemoveOrganizationSecretSource,
} from '@/hooks/queries/organization-secrets'
import {
  useSearchIntegrations,
  useUpdateSearchIntegration,
} from '@/hooks/queries/search-integrations'

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

/** Adds or reconfigures the Generic Secrets source; an organization source then opens its secrets. */
export function useGenericSecretSourceSetup(organizationId: string) {
  const configure = useConfigureOrganizationSecretSource(organizationId)
  const router = useRouter()
  return {
    pending: configure.isPending,
    save: async (sourceId: string | null, mode: SecretSourceMode) => {
      await configure.mutateAsync({ sourceId, mode })
      if (mode === 'organization')
        router.push(organizationRoutes(organizationId).organizationSecrets)
    },
  }
}

/** Removes the Generic Secrets source; a failure toasts and resolves `false` to keep the dialog open. */
export function useGenericSecretSourceRemoval(organizationId: string) {
  const remove = useRemoveOrganizationSecretSource(organizationId)
  return async (sourceId: string) => {
    try {
      await remove.mutateAsync(sourceId)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove the source'))
      return false
    }
  }
}
