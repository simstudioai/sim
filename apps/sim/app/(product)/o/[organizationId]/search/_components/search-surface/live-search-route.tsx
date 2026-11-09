import 'server-only'
import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { SearchSurface } from '@/app/(product)/o/[organizationId]/search/_components/search-surface/search-surface'
import { readChatMode } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchSearch } from '@/platform/lib/data/prefetch-search'
import { readPinnedSearchHref } from '@/platform/lib/data/search-pin'
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
  if (!organization.searchAccess.memberScoped) redirect(surfaceHref(organization, '/settings'))
  if (chatId) {
    if (!organization.mothershipAvailable) redirect(surfaceHref(organization, '/search'))
    const mode = await readChatMode(chatId, organization.organization.id)
    if (!mode) notFound()
    if (mode !== 'assistant') redirect(surfaceHref(organization, `/chat/${chatId}`))
    return <SearchSurface chatId={chatId} />
  }
  const pinned = await readPinnedSearchHref(organization, searchParams)
  if (pinned) redirect(pinned)
  return (
    <HydrationBoundary state={await prefetchSearch(organization)}>
      <SearchSurface />
    </HydrationBoundary>
  )
}
