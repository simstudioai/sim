import 'server-only'
import type { SessionPrincipal } from '@sim/auth/principal'
import { sleep } from '@sim/utils/helpers'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listSearchHistoryContract } from '@/lib/api/contracts/knowledge/search-history'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { listSearchHistory } from '@/lib/knowledge/application/search-history'
import { listSearchIntegrations } from '@/lib/knowledge/application/search-integrations'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import {
  SEARCH_HISTORY_STALE_TIME,
  searchHistoryKeys,
} from '@/hooks/queries/utils/search-history-keys'
import {
  SEARCH_INTEGRATIONS_STALE_TIME,
  searchIntegrationKeys,
} from '@/hooks/queries/utils/search-integration-keys'

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

function withinBudget<T>(read: Promise<T>): Promise<T> {
  return Promise.race([
    read,
    sleep(PREFETCH_TIMEOUT_MS).then(() => {
      throw new Error('Home prefetch exceeded its budget')
    }),
  ])
}

/**
 * What decides each widget's state, so a viewer with no connection paints their prompt at once. Runs
 * the routes' own use cases and contract schemas under the hooks' keys; a failed or slow read stays
 * out of hydration for the client to retry. Provider reads stay on the client: they can take seconds.
 */
export async function prefetchHome(
  surface: Parameters<typeof canReadMemberIntegrations>[0] & { organization: { id: string } },
  principal: SessionPrincipal
): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  const organizationId = surface.organization.id
  const input = { organizationId }
  const seed = <T>(queryKey: readonly unknown[], staleTime: number, read: () => Promise<T>) =>
    queryClient.prefetchQuery({ queryKey, staleTime, queryFn: read })
  const reads: Promise<void>[] = []
  if (canReadMemberIntegrations(surface)) {
    reads.push(
      seed(
        organizationAccountsKeys.detail(organizationId),
        ORGANIZATION_ACCOUNTS_STALE_TIME,
        async () =>
          getOrganizationAccountsContract.response.schema.parse(
            await withinBudget(getOrganizationAccountsSettings.execute({ principal, input }))
          )
      ),
      seed(
        searchIntegrationKeys.list(organizationId),
        SEARCH_INTEGRATIONS_STALE_TIME,
        async () =>
          listSearchIntegrationsContract.response.schema.parse({
            success: true,
            data: await withinBudget(listSearchIntegrations.execute({ principal, input })),
          }).data
      )
    )
  }
  if (surface.searchAccess.memberScoped) {
    reads.push(
      seed(
        searchHistoryKeys.list(organizationId, principal.userId),
        SEARCH_HISTORY_STALE_TIME,
        async () =>
          listSearchHistoryContract.response.schema.parse(
            await withinBudget(listSearchHistory.execute({ principal, input }))
          )
      )
    )
  }
  await Promise.all(reads)
  return dehydrate(queryClient)
}
