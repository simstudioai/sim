import { HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LinksSurface } from '@/app/o/[organizationId]/links/links-surface'
import { loadSimLinksListView } from '@/app/o/[organizationId]/links/search-params'
import { LinksPage } from '@/platform/app/(shell)/links/_components/links-page/links-page'
import { prefetchSimLinks } from '@/platform/lib/data/prefetch'

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
    <LinksSurface>
      <HydrationBoundary state={state}>
        <LinksPage organizationId={organizationId} />
      </HydrationBoundary>
    </LinksSurface>
  )
}
