import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { resourceParam } from '@/lib/mothership/chat/search-params'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { seedMemberInventory } from '@/platform/lib/data/prefetch-member-inventory'
import { seedSearchHistory } from '@/platform/lib/data/prefetch-search'

/**
 * Legacy Home was a new chat with a resource panel, so a builder's Home address that opens a
 * resource (`?resource=`, with a results tab's `?q=` and filters) goes to the new chat, which owns
 * that panel now.
 */
export function resolveHomeHandoff(
  organization: PlatformOrganization,
  searchParams: Record<string, string | string[] | undefined>
): string | null {
  if (!searchParams[resourceParam.key]) return null
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const entry of [value ?? []].flat()) query.append(key, entry)
  return `${surfaceHref(organization, '/chat')}?${query}`
}

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
