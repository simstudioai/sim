import 'server-only'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { DehydratedState } from '@tanstack/react-query'
import { listOrganizationAccessRequestsContract } from '@/lib/api/contracts/access-requests'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { listSearchIntegrations } from '@/lib/knowledge/application/search-integrations'
import { listOrganizationAccessRequests } from '@/ee/access-requests/lib/application/requests'
import { ACCESS_REQUEST_LIST_PAGE_SIZE } from '@/ee/access-requests/lib/constants'
import {
  ACCESS_REQUESTS_STALE_TIME,
  accessRequestKeys,
} from '@/hooks/queries/utils/access-request-keys'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import {
  SEARCH_INTEGRATIONS_STALE_TIME,
  searchIntegrationKeys,
} from '@/hooks/queries/utils/search-integration-keys'
import { createSeeds } from '@/platform/embedded/lib/data/prefetch'

type PrefetchSurface = Parameters<typeof canReadMemberIntegrations>[0] & {
  organization: { id: string }
  viewer: { isAdmin: boolean }
}

function seedMemberInventory(
  seeds: ReturnType<typeof createSeeds>,
  surface: PrefetchSurface,
  principal: SessionPrincipal
) {
  if (!canReadMemberIntegrations(surface)) return []
  const organizationId = surface.organization.id
  const input = { organizationId }
  return [
    seeds.seed(
      organizationAccountsKeys.detail(organizationId),
      ORGANIZATION_ACCOUNTS_STALE_TIME,
      async () =>
        getOrganizationAccountsContract.response.schema.parse(
          await getOrganizationAccountsSettings.execute({ principal, input })
        )
    ),
    seeds.seed(
      searchIntegrationKeys.list(organizationId),
      SEARCH_INTEGRATIONS_STALE_TIME,
      async () =>
        listSearchIntegrationsContract.response.schema.parse({
          success: true,
          data: await listSearchIntegrations.execute({ principal, input }),
        }).data
    ),
  ]
}

/** The requests an admin's attention list opens with, under the key that list reads. */
function seedPendingAccessRequests(
  seeds: ReturnType<typeof createSeeds>,
  surface: PrefetchSurface,
  principal: SessionPrincipal
) {
  const organizationId = surface.organization.id
  return seeds.seed(
    accessRequestKeys.organization(organizationId, 0, 'pending', ''),
    ACCESS_REQUESTS_STALE_TIME,
    async () =>
      listOrganizationAccessRequestsContract.response.schema.parse(
        await listOrganizationAccessRequests.execute({
          principal,
          input: {
            organizationId,
            offset: 0,
            limit: ACCESS_REQUEST_LIST_PAGE_SIZE,
            status: 'pending',
          },
        })
      )
  )
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
    ...seedMemberInventory(seeds, surface, principal),
    ...(surface.searchAccess.memberScoped ? [seeds.searchHistory()] : []),
    ...(surface.viewer.isAdmin ? [seedPendingAccessRequests(seeds, surface, principal)] : []),
  ])
}

export function prefetchIntegrations(
  surface: PrefetchSurface,
  principal: SessionPrincipal
): Promise<DehydratedState> {
  const seeds = createSeeds(surface.organization.id, principal)
  return seeds.settle([...seedMemberInventory(seeds, surface, principal), seeds.secretSource()])
}
