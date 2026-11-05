import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import { HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { OrganizationSearchSurface } from '@/platform/app/(shell)/search/_components/search-surface/search-surface'
import { prefetchSearch } from '@/platform/lib/data/prefetch'

export const metadata: Metadata = { title: 'Search' }

interface PrefetchedSearchProps {
  organizationId: string
  principal: SessionPrincipal
}

/** Holds only its own boundary, so the page's arrangement paints before the read settles. */
async function PrefetchedSearch({ organizationId, principal }: PrefetchedSearchProps) {
  return (
    <HydrationBoundary state={await prefetchSearch(organizationId, principal)}>
      <OrganizationSearchSurface userId={principal.userId} />
    </HydrationBoundary>
  )
}

export default async function OrganizationSearchPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  return (
    <Suspense fallback={<HomeFallback />}>
      <PrefetchedSearch
        organizationId={organizationId}
        principal={{ kind: 'session', userId: session.user.id, sessionId: session.session.id }}
      />
    </Suspense>
  )
}
