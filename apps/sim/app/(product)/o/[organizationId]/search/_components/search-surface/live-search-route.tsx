import 'server-only'
import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { SearchSurface } from '@/app/(product)/o/[organizationId]/search/_components/search-surface/search-surface'
import { readOpenChat } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchSearch } from '@/platform/lib/data/prefetch-search'
import {
  deniedSurfaceHref,
  followProductRoute,
  productLocation,
} from '@/platform/lib/data/route-resolution'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

interface LiveSearchRouteProps {
  chatId?: string
  searchParams?: Record<string, string | string[] | undefined>
}

/** The legacy Search and Assistant chat pages' gates, in their order. */
export async function LiveSearchRoute({ chatId, searchParams = {} }: LiveSearchRouteProps) {
  const surface = await readOrganizationSurface()
  // A tab left open on an organization the viewer has left, such as a retired personal one.
  if (surface.status === 'denied') {
    const href = deniedSurfaceHref(surface.retired)
    if (href) redirect(href)
    notFound()
  }
  if (surface.status !== 'ok') return null
  const { organization } = surface
  const path = chatId ? `/search/chat/${encodeURIComponent(chatId)}` : '/search'
  await followProductRoute(
    organization,
    productLocation(surfaceHref(organization, path), searchParams)
  )
  if (chatId) {
    const entry = await readOpenChat(chatId, organization.organization.id)
    if (!entry) notFound()
    if (entry.mode !== 'assistant') redirect(surfaceHref(organization, `/chat/${chatId}`))
    return <SearchSurface chat={entry.chat} />
  }
  return (
    <HydrationBoundary state={await prefetchSearch(organization)}>
      <SearchSurface />
    </HydrationBoundary>
  )
}
