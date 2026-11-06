import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { seedMemberInventory } from '@/platform/lib/data/prefetch-integrations'
import { seedSearchHistory } from '@/platform/lib/data/prefetch-search'

/**
 * What decides each widget's state and the viewer's recents, so a viewer with no connection paints
 * their prompt at once. The provider reads stay on the client: they can take seconds and must never
 * hold the page.
 */
export async function prefetchHome(organization: PlatformOrganization): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await Promise.all([
    seedMemberInventory(queryClient, organization),
    seedSearchHistory(queryClient, organization),
  ])
  return dehydrate(queryClient)
}
