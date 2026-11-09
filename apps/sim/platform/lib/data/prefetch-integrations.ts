import 'server-only'
import { type DehydratedState, dehydrate, type QueryClient } from '@tanstack/react-query'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { listSearchIntegrations } from '@/lib/knowledge/application/search-integrations'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  SEARCH_INTEGRATIONS_STALE_TIME,
  searchIntegrationKeys,
} from '@/hooks/queries/utils/search-integration-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/** The viewer's accounts and the policies over them. Provider reads stay on the client. */
export async function seedMemberInventory(
  queryClient: QueryClient,
  organization: PlatformOrganization
): Promise<void> {
  if (!canReadMemberIntegrations(organization)) return
  const organizationId = organization.organization.id
  const input = { organizationId }
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: organizationAccountsKeys.detail(organizationId),
      queryFn: () =>
        withinPrefetchBudget(async () => {
          const { principal } = await requireSessionViewer()
          return asRouteResponse(
            getOrganizationAccountsContract,
            await getOrganizationAccountsSettings.execute({ principal, input })
          )
        }),
      staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: searchIntegrationKeys.list(organizationId),
      queryFn: () =>
        withinPrefetchBudget(async () => {
          const { principal } = await requireSessionViewer()
          const { data } = await asRouteResponse(listSearchIntegrationsContract, {
            success: true,
            data: await listSearchIntegrations.execute({ principal, input }),
          })
          return data
        }),
      staleTime: SEARCH_INTEGRATIONS_STALE_TIME,
    }),
  ])
}

/** The Integrations list's first paint. */
export async function prefetchIntegrations(
  organization: PlatformOrganization
): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await seedMemberInventory(queryClient, organization)
  return dehydrate(queryClient)
}
