import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { loadOrganizationSearchView } from '@/app/o/[organizationId]/search/search-params'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { LandingSkeleton } from '@/platform/app/(shell)/_components/conversation/skeletons'
import { OrganizationSearchSurface } from '@/platform/app/(shell)/search/_components/search-surface/search-surface'
import { prefetchSearch } from '@/platform/lib/data/prefetch'

export const metadata: Metadata = { title: 'Search' }

export default async function OrganizationSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams])
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  const surface = <OrganizationSearchSurface userId={session.user.id} />
  const { q, mode } = loadOrganizationSearchView(query)
  const fallback =
    mode === 'assistant' ? (
      <LandingSkeleton field='composer' />
    ) : q.trim() ? (
      <HomeFallback />
    ) : (
      <LandingSkeleton field='search' />
    )
  return (
    <Suspense fallback={fallback}>
      {q.trim() || mode === 'assistant' ? (
        surface
      ) : (
        <Hydrated
          state={prefetchSearch(organizationId, {
            kind: 'session',
            userId: session.user.id,
            sessionId: session.session.id,
          })}
        >
          {surface}
        </Hydrated>
      )}
    </Suspense>
  )
}
