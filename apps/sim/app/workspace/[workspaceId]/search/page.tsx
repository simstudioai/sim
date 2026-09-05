import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
import { Search } from '@/app/workspace/[workspaceId]/search/search'

export const metadata: Metadata = {
  title: 'Search',
}

/**
 * Sim Search page entry, served only where per-member access is on: the whole
 * surface is the feature, so with it off the route is not there to be typed,
 * linked, or bookmarked into — the same judgement the tab header hides itself
 * on. The host context is request-memoized, so this re-reads what the workspace
 * layout already resolved.
 *
 * `Search` reads URL query params via nuqs (which uses `useSearchParams`
 * internally), so it must sit under a Suspense boundary. The fallback renders
 * the real page chrome (background + tab header) so a suspend never shows a
 * blank frame.
 */
export default async function SearchPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId } = await params
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  if (!hostContext?.features?.knowledgeMemberAccess) notFound()

  return (
    <Suspense
      fallback={
        <div className='flex h-full flex-col bg-[var(--bg)]'>
          <IntegrationTabsHeader active='search' workspaceId={workspaceId} />
        </div>
      }
    >
      <Search />
    </Suspense>
  )
}
