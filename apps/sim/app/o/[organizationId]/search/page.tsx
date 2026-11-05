import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { prefetchSearch } from '@/app/o/[organizationId]/_redesign/prefetch'
import { OrganizationSearchSurface } from '@/app/o/[organizationId]/_redesign/search/search-surface'
import { loadOrganizationSearchView } from '@/app/o/[organizationId]/search/search-params'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

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
  return (
    <Suspense fallback={<HomeFallback />}>
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
