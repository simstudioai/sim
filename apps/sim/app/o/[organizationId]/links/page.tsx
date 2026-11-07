import { PageSurface } from '@sim/emcn-platform/surface'
import { HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { loadSimLinksListView } from '@/lib/sim-links/search-params'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { LinksPage } from '@/platform/embedded/app/(shell)/links/_components/links-page/links-page'
import { prefetchSimLinks } from '@/platform/embedded/lib/data/prefetch'

export const metadata: Metadata = { title: 'Links' }

interface SimLinksPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SimLinksPage({ params, searchParams }: SimLinksPageProps) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams])
  const { principal } = await requireOrganizationViewer(
    organizationId,
    organizationRoutes(organizationId).simLinks
  )
  if (!(await isSimLinksEnabled(organizationId))) notFound()
  const state = await prefetchSimLinks(organizationId, principal, loadSimLinksListView(query))
  return (
    <PageSurface>
      <HydrationBoundary state={state}>
        <LinksPage organizationId={organizationId} />
      </HydrationBoundary>
    </PageSurface>
  )
}
