import { HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { loadSimLinksListView } from '@/lib/sim-links/search-params'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { prefetchSimLinks } from '@/app/o/[organizationId]/_redesign/prefetch'
import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { LinksPage } from '@/platform/app/(shell)/_components/links-page/links-page'

export const metadata: Metadata = { title: 'Links' }

interface SimLinksPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SimLinksPage({ params, searchParams }: SimLinksPageProps) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams])
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).simLinks,
        isInviteFlow: false,
      })
    )
  if (!(await isSimLinksEnabled(organizationId))) notFound()
  const state = await prefetchSimLinks(
    organizationId,
    { kind: 'session', userId: session.user.id, sessionId: session.session.id },
    loadSimLinksListView(query)
  )
  return (
    <RedesignPageSurface>
      <HydrationBoundary state={state}>
        <LinksPage organizationId={organizationId} />
      </HydrationBoundary>
    </RedesignPageSurface>
  )
}
