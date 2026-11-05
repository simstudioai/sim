import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  SEARCH_INTEGRATIONS_STALE_TIME,
  searchIntegrationKeys,
} from '@/hooks/queries/utils/search-integration-keys'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'
import { serverRequestJson } from '@/platform/lib/data/server-request'

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

/** The legacy Home page's gate: a member who cannot build goes to Search, otherwise to Settings. */
export function resolveHomeRedirect(organization: PlatformOrganization): string | null {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  if (mothershipAvailable && canBuild) return null
  const routes = legacyRoutes(organization)
  return searchAccess.memberScoped ? routes.search : routes.workspaceSettings
}

/**
 * What decides each widget's state, so a viewer with no connection paints their prompt at once. The
 * provider reads stay on the client: they can take seconds and must never hold the page.
 */
export async function prefetchHome(organization: PlatformOrganization): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  if (canReadMemberIntegrations(organization)) {
    const organizationId = organization.organization.id
    const signal = () => AbortSignal.timeout(PREFETCH_TIMEOUT_MS)
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: organizationAccountsKeys.detail(organizationId),
        queryFn: () =>
          serverRequestJson(getOrganizationAccountsContract, {
            params: { id: organizationId },
            signal: signal(),
          }),
        staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
      }),
      queryClient.prefetchQuery({
        queryKey: searchIntegrationKeys.list(organizationId),
        queryFn: async () =>
          (
            await serverRequestJson(listSearchIntegrationsContract, {
              query: { organizationId },
              signal: signal(),
            })
          ).data,
        staleTime: SEARCH_INTEGRATIONS_STALE_TIME,
      }),
    ])
  }
  return dehydrate(queryClient)
}
