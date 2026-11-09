import 'server-only'
import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { SearchSurface } from '@/app/(product)/o/[organizationId]/search/_components/search-surface/search-surface'
import { readChatMode } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchSearch } from '@/platform/lib/data/prefetch-search'
import { followProductRoute, productLocation } from '@/platform/lib/data/route-resolution'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

interface LiveSearchRouteProps {
  chatId?: string
  searchParams?: Record<string, string | string[] | undefined>
}

/** The legacy Search and Assistant chat pages' gates, in their order. */
export async function LiveSearchRoute({ chatId, searchParams = {} }: LiveSearchRouteProps) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { organization } = surface
  const path = chatId ? `/search/chat/${encodeURIComponent(chatId)}` : '/search'
  await followProductRoute(
    organization,
    productLocation(surfaceHref(organization, path), searchParams)
  )
  if (chatId) {
    const mode = await readChatMode(chatId, organization.organization.id)
    if (!mode) notFound()
    if (mode !== 'assistant') redirect(surfaceHref(organization, `/chat/${chatId}`))
    return <SearchSurface chatId={chatId} />
  }
  return (
    <HydrationBoundary state={await prefetchSearch(organization)}>
      <SearchSurface />
    </HydrationBoundary>
  )
}
