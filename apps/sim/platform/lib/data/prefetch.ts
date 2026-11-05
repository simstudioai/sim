import 'server-only'
import type { SessionPrincipal } from '@sim/auth/principal'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listSearchHistoryContract } from '@/lib/api/contracts/knowledge/search-history'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { getSecretSourceContract } from '@/lib/api/contracts/organization-secrets'
import { listSimLinksContract } from '@/lib/api/contracts/sim-links'
import { presentSimLinkPage } from '@/lib/api/server/sim-link-presenters'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { listSearchHistory } from '@/lib/knowledge/application/search-history'
import { listSearchIntegrations } from '@/lib/knowledge/application/search-integrations'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import { listSimLinks } from '@/lib/sim-links/application/use-cases'
import type { SimLinkSort } from '@/lib/sim-links/validation'
import type { SortDirection } from '@/lib/url-state'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import {
  ORGANIZATION_SECRET_STALE_TIME,
  organizationSecretKeys,
} from '@/hooks/queries/utils/organization-secret-keys'
import {
  SEARCH_HISTORY_STALE_TIME,
  searchHistoryKeys,
} from '@/hooks/queries/utils/search-history-keys'
import {
  SEARCH_INTEGRATIONS_STALE_TIME,
  searchIntegrationKeys,
} from '@/hooks/queries/utils/search-integration-keys'
import { SIM_LINKS_STALE_TIME, simLinkKeys } from '@/hooks/queries/utils/sim-link-keys'

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

function withinBudget<T>(read: () => Promise<T>) {
  return () => withinDeadline(read, Date.now() + PREFETCH_TIMEOUT_MS)
}

type PrefetchSurface = Parameters<typeof canReadMemberIntegrations>[0] & {
  organization: { id: string }
}

interface SimLinksListView {
  search: string
  sort: SimLinkSort
  dir: SortDirection
}

/**
 * The cheap reads behind first paint. Each runs its route's use case and contract schema under its
 * hook's key, together rather than in turn. A failed or slow read stays out of hydration for the
 * client to retry, and a read the route would refuse this viewer fails the same way here.
 */
function createSeeds(organizationId: string, principal: SessionPrincipal) {
  const queryClient = makeQueryClient()
  const input = { organizationId }
  const seed = <T>(queryKey: readonly unknown[], staleTime: number, read: () => Promise<T>) =>
    queryClient.prefetchQuery({ queryKey, staleTime, queryFn: withinBudget(read) })
  return {
    memberInventory: (surface: PrefetchSurface) =>
      canReadMemberIntegrations(surface)
        ? [
            seed(
              organizationAccountsKeys.detail(organizationId),
              ORGANIZATION_ACCOUNTS_STALE_TIME,
              async () =>
                getOrganizationAccountsContract.response.schema.parse(
                  await getOrganizationAccountsSettings.execute({ principal, input })
                )
            ),
            seed(
              searchIntegrationKeys.list(organizationId),
              SEARCH_INTEGRATIONS_STALE_TIME,
              async () =>
                listSearchIntegrationsContract.response.schema.parse({
                  success: true,
                  data: await listSearchIntegrations.execute({ principal, input }),
                }).data
            ),
          ]
        : [],
    searchHistory: () =>
      seed(
        searchHistoryKeys.list(organizationId, principal.userId),
        SEARCH_HISTORY_STALE_TIME,
        async () =>
          listSearchHistoryContract.response.schema.parse(
            await listSearchHistory.execute({ principal, input })
          )
      ),
    secretSource: () =>
      seed(
        organizationSecretKeys.source(organizationId),
        ORGANIZATION_SECRET_STALE_TIME,
        async () =>
          getSecretSourceContract.response.schema.parse(
            await readOrganizationSecretSource.execute({ principal, input })
          )
      ),
    simLinks: ({ search, sort, dir }: SimLinksListView) => {
      const term = search.trim()
      return queryClient.prefetchInfiniteQuery({
        queryKey: simLinkKeys.list(organizationId, term, sort, dir),
        staleTime: SIM_LINKS_STALE_TIME,
        initialPageParam: undefined as string | undefined,
        queryFn: withinBudget(async () =>
          listSimLinksContract.response.schema.parse(
            presentSimLinkPage(
              await listSimLinks.execute({
                principal,
                input: { organizationId, search: term || undefined, sort, dir },
              })
            )
          )
        ),
      })
    },
    settle: async (reads: readonly Promise<void>[]): Promise<DehydratedState> => {
      await Promise.all(reads)
      return dehydrate(queryClient)
    },
  }
}

/**
 * What decides each Home widget's state, so a viewer with no connection paints their prompt at once.
 * Provider reads stay on the client: they can take seconds.
 */
export function prefetchHome(
  surface: PrefetchSurface,
  principal: SessionPrincipal
): Promise<DehydratedState> {
  const seeds = createSeeds(surface.organization.id, principal)
  return seeds.settle([
    ...seeds.memberInventory(surface),
    ...(surface.searchAccess.memberScoped ? [seeds.searchHistory()] : []),
  ])
}

/** The history under Search's field. Results stay on the client: they are the slow live read. */
export function prefetchSearch(
  organizationId: string,
  principal: SessionPrincipal
): Promise<DehydratedState> {
  const seeds = createSeeds(organizationId, principal)
  return seeds.settle([seeds.searchHistory()])
}

/** The member inventory and secret source the Integrations pages list. */
export function prefetchIntegrations(
  surface: PrefetchSurface,
  principal: SessionPrincipal
): Promise<DehydratedState> {
  const seeds = createSeeds(surface.organization.id, principal)
  return seeds.settle([...seeds.memberInventory(surface), seeds.secretSource()])
}

/** The first page of the list the URL asks for. Later pages load as the table scrolls. */
export function prefetchSimLinks(
  organizationId: string,
  principal: SessionPrincipal,
  view: SimLinksListView
): Promise<DehydratedState> {
  const seeds = createSeeds(organizationId, principal)
  return seeds.settle([seeds.simLinks(view)])
}
