import 'server-only'
import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { SearchSurface } from '@/app/(product)/o/[organizationId]/search/_components/search-surface/search-surface'
import { readChatMode } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchSearch } from '@/platform/lib/data/prefetch-search'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** The legacy Search and Assistant chat pages' gates, in their order. */
export async function LiveSearchRoute({ chatId }: { chatId?: string }) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (!organization.searchAccess.memberScoped) redirect(surfaceHref(organization, '/settings'))
  if (chatId) {
    if (!organization.mothershipAvailable) redirect(surfaceHref(organization, '/search'))
    const mode = await readChatMode(chatId)
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
