import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  integrationSearchParsers,
  integrationSearchUrlKeys,
  integrationViewParsers,
  serializeIntegrationView,
} from '@/lib/organizations/integrations-search-params'
import { toast } from '@/lib/toast/sink'
import {
  useAssistantToolPermissions,
  useUpdateAssistantToolPermissions,
} from '@/hooks/queries/assistant-actions'
import {
  useConnectOrganizationAccount,
  useDisconnectPersonalOrganizationAccount,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationSecretSource } from '@/hooks/queries/organization-secrets'
import { useRemovePersonalSearchCredential } from '@/hooks/queries/personal-search-integrations'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import type { SavedSearchConnection } from '@/platform/lib/data/integration-handoff'
import {
  toGenericSecrets,
  toOrganizationIntegrations,
  toToolPermissions,
} from '@/platform/lib/data/integrations-model'
import type { OrganizationIntegration, ToolPermissionChange } from '@/platform/shared/integrations'

const ACTION_NOTICE_ID = 'integrations-action'

function reportActionFailure(error: unknown) {
  toast.error(getErrorMessage(error, 'That did not work. Try again.'), {
    noticeId: ACTION_NOTICE_ID,
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

/**
 * Connects, reconnects and disconnects the member's own accounts. An account the member saves by
 * hand opens `savedConnection` in place instead, as the legacy saved-credential dialog did, for the
 * surface to render with `SavedAccountModal`.
 */
export function useIntegrationActions(organizationId: string) {
  const [savedConnection, setSavedConnection] = useState<SavedSearchConnection | null>(null)
  const savedAccounts = useOrganizationAccounts(organizationId).data?.viewerSavedAccounts ?? []
  const removeSaved = useRemovePersonalSearchCredential()
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const onError = reportActionFailure
  const connecting = connect.isPending || reconnect.isPending
  return {
    connecting,
    pending: connecting || disconnect.isPending || removeSaved.isPending,
    savedConnection,
    closeSavedConnection: () => setSavedConnection(null),
    connect: (target: NonNullable<OrganizationIntegration['connectionTarget']>) => {
      if ('savedProviderId' in target) setSavedConnection({ providerId: target.savedProviderId })
      else connect.mutate({ organizationId, ...target }, { onError })
    },
    reconnect: (credentialId: string) => {
      const saved = savedAccounts.find((account) => account.credentialId === credentialId)
      if (saved)
        setSavedConnection({
          providerId: saved.providerId,
          credentialId,
          displayName: saved.displayName,
        })
      else reconnect.mutate(credentialId, { onError })
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
  const onError = reportActionFailure
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

export function defaultIntegrationPaths(organizationId: string) {
  const routes = organizationRoutes(organizationId)
  return { index: routes.integrations, memberSecrets: routes.memberSecrets }
}

/** The page's URL state, and where an OAuth round trip returns to it. */
export function useIntegrationsView() {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const [{ q: search }, setSearchParams] = useQueryStates(
    integrationSearchParsers,
    integrationSearchUrlKeys
  )
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setSearchParams({ q: value }, options)
  )
  const [{ account }, setParams] = useQueryStates(integrationViewParsers)
  return {
    search,
    setSearch,
    account,
    clearAccount: () => void setParams({ account: null, tools: null }),
    serialize: serializeIntegrationView,
  }
}

/** The tool filter on an account's permissions, kept in the URL. */
export function useToolPermissionsSearch() {
  const [{ tools: search }, setParams] = useQueryStates(integrationViewParsers)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ tools: value }, options)
  )
  return { search, setSearch }
}
