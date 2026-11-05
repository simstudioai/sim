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
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { prefetchSignal, serverRequestJson } from '@/platform/lib/data/server-request'

/**
 * What decides each widget's state, so a viewer with no connection paints their prompt at once. The
 * provider reads stay on the client: they can take seconds and must never hold the page.
 */
export async function prefetchHome(organization: PlatformOrganization): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  if (canReadMemberIntegrations(organization)) {
    const organizationId = organization.organization.id
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: organizationAccountsKeys.detail(organizationId),
        queryFn: () =>
          serverRequestJson(getOrganizationAccountsContract, {
            params: { id: organizationId },
            signal: prefetchSignal(),
          }),
        staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
      }),
      queryClient.prefetchQuery({
        queryKey: searchIntegrationKeys.list(organizationId),
        queryFn: async () =>
          (
            await serverRequestJson(listSearchIntegrationsContract, {
              query: { organizationId },
              signal: prefetchSignal(),
            })
          ).data,
        staleTime: SEARCH_INTEGRATIONS_STALE_TIME,
      }),
    ])
  }
  return dehydrate(queryClient)
}
