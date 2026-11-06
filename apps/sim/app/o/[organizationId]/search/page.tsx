import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { loadOrganizationSearchView } from '@/lib/organizations/search-params'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import {
  LandingSkeleton,
  ResultsSkeleton,
} from '@/platform/app/(shell)/_components/conversation/skeletons'
import { OrganizationSearchSurface } from '@/platform/app/(shell)/search/_components/search-surface/search-surface'
import { Hydrated } from '@/platform/design-system/components/surface/hydrated'
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
  const {
    userId,
    principal,
    surface: context,
  } = await requireOrganizationViewer(organizationId, organizationRoutes(organizationId).search)
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  const surface = <OrganizationSearchSurface userId={userId} />
  const { q, mode } = loadOrganizationSearchView(query)
  const fallback =
    mode === 'assistant' ? (
      <LandingSkeleton field='composer' />
    ) : q.trim() ? (
      <ResultsSkeleton />
    ) : (
      <LandingSkeleton field='search' />
    )
  return (
    <Suspense fallback={fallback}>
      {q.trim() || mode === 'assistant' ? (
        surface
      ) : (
        <Hydrated state={prefetchSearch(organizationId, principal)}>{surface}</Hydrated>
      )}
    </Suspense>
  )
}
