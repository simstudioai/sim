import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getSecretSourceContract } from '@/lib/api/contracts/organization-secrets'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import {
  ORGANIZATION_SECRET_STALE_TIME,
  organizationSecretKeys,
} from '@/hooks/queries/utils/organization-secret-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { seedMemberInventory } from '@/platform/lib/data/prefetch-member-inventory'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/** The Integrations list's first paint: the inventory and the Generic Secrets row under it. */
export async function prefetchIntegrations(
  organization: PlatformOrganization
): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  const organizationId = organization.organization.id
  await Promise.all([
    seedMemberInventory(queryClient, organization),
    queryClient.prefetchQuery({
      queryKey: organizationSecretKeys.source(organizationId),
      queryFn: () =>
        withinPrefetchBudget(async () => {
          const { principal } = await requireSessionViewer()
          return asRouteResponse(
            getSecretSourceContract,
            await readOrganizationSecretSource.execute({ principal, input: { organizationId } })
          )
        }),
      staleTime: ORGANIZATION_SECRET_STALE_TIME,
    }),
  ])
  return dehydrate(queryClient)
}
