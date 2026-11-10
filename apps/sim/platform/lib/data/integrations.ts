import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
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
import { integrationsWorkspaceParams } from '@/platform/lib/integrations/center-navigation'
import type { OrganizationIntegration, ToolPermissionChange } from '@/platform/shared/integrations'

const ACTION_NOTICE_ID = 'integrations-action'

function reportActionFailure(error: unknown) {
  toast.error(getErrorMessage(error, 'That did not work. Try again.'), {
    noticeId: ACTION_NOTICE_ID,
  })
}

/**
 * The member inventory and its reads, each failing and retrying on its own. An organization without
 * member-scoped accounts passes no id and reads nothing.
 */
export function useMemberIntegrations(organizationId: string | undefined) {
  const inventory = useOrganizationAccounts(organizationId)
  const policies = useSearchIntegrations(organizationId ?? '')
  const secrets = useOrganizationSecretSource(organizationId ?? '')
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
 * hand opens `savedConnection` in place instead, for the
 * surface to render with `SavedAccountModal`.
 */
export function useIntegrationActions(organizationId: string, options?: { enabled?: boolean }) {
  const [savedConnection, setSavedConnection] = useState<SavedSearchConnection | null>(null)
  const inventoryId = (options?.enabled ?? true) ? organizationId : undefined
  const savedAccounts = useOrganizationAccounts(inventoryId).data?.viewerSavedAccounts ?? []
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

/**
 * The page's URL state: the account a detail page opens, and the workspace every tab lists within.
 * Choosing a workspace reloads the server's verdict on which apps that workspace may use.
 */
export function useIntegrationsView() {
  const [{ account }, setParams] = useQueryStates(integrationViewParsers)
  const [, setWorkspace] = useQueryStates(integrationsWorkspaceParams, {
    history: 'push',
    shallow: false,
  })
  return {
    account,
    clearAccount: () => void setParams({ account: null, tools: null }),
    serialize: serializeIntegrationView,
    chooseWorkspace: (workspace: string) => void setWorkspace({ workspace }),
  }
}

/**
 * Reports a provider sign-in that returns to the Integrations page, once for the page: the
 * organization's own connections and the chosen workspace's.
 */
export function useIntegrationsOAuthReturn(workspaceId: string | undefined) {
  useOAuthReturnRouter({ workspaceId })
  useDesktopOAuthConnectListener()
}

/** The tool filter on an account's permissions, kept in the URL. */
export function useToolPermissionsSearch() {
  const [{ tools: search }, setParams] = useQueryStates(integrationViewParsers)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ tools: value }, options)
  )
  return { search, setSearch }
}
