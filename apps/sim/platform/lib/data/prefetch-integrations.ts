import 'server-only'
import { type DehydratedState, dehydrate, type QueryClient } from '@tanstack/react-query'
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
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { prefetchRequestJson } from '@/platform/lib/data/server-request'

/** The viewer's accounts and the policies over them. Provider reads stay on the client. */
export async function seedMemberInventory(
  queryClient: QueryClient,
  organization: PlatformOrganization
): Promise<void> {
  if (!canReadMemberIntegrations(organization)) return
  const organizationId = organization.organization.id
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: organizationAccountsKeys.detail(organizationId),
      queryFn: () =>
        prefetchRequestJson(getOrganizationAccountsContract, {
          params: { id: organizationId },
        }),
      staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: searchIntegrationKeys.list(organizationId),
      queryFn: async () =>
        (
          await prefetchRequestJson(listSearchIntegrationsContract, {
            query: { organizationId },
          })
        ).data,
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
