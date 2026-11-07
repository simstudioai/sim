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
import {
  toGenericSecrets,
  toOrganizationIntegrations,
  toToolPermissions,
} from '@/platform/lib/data/integrations-model'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import type { OrganizationIntegration, ToolPermissionChange } from '@/platform/shared/integrations'
import { toast } from '@/platform/shared/toast'

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

/** A saved provider's id is its integration's URL segment plus this. */
const SAVED_PROVIDER_SUFFIX = /-service-account$/

/** Runs once a popup or desktop connection finishes, not when it merely opens. */
interface ConnectionOptions {
  onSuccess?: () => void
}

/**
 * The zone has no dialog for an account the member saves by hand, so connecting one happens on the
 * legacy provider page, a route the legacy layout does not map back here.
 */
export function useIntegrationActions(organizationId: string) {
  const organization = useOrganization()
  const savedAccounts = useOrganizationAccounts(organizationId).data?.viewerSavedAccounts ?? []
  const removeSaved = useRemovePersonalSearchCredential()
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const onError = reportActionFailure
  const connecting = connect.isPending || reconnect.isPending
  const openSavedConnection = (providerId: string) =>
    window.location.assign(
      legacyRoutes(organization).integration(providerId.replace(SAVED_PROVIDER_SUFFIX, ''))
    )
  return {
    connecting,
    pending: connecting || disconnect.isPending || removeSaved.isPending,
    connect: (
      target: NonNullable<OrganizationIntegration['connectionTarget']>,
      options?: ConnectionOptions
    ) => {
      if ('savedProviderId' in target) openSavedConnection(target.savedProviderId)
      else connect.mutate({ organizationId, ...target }, { onError, onSuccess: options?.onSuccess })
    },
    reconnect: (credentialId: string, options?: ConnectionOptions) => {
      const saved = savedAccounts.find((account) => account.credentialId === credentialId)
      if (saved) openSavedConnection(saved.providerId)
      else reconnect.mutate(credentialId, { onError, onSuccess: options?.onSuccess })
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
