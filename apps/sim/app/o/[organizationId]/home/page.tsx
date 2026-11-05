import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import { HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import {
  getOrganizationSurfaceContext,
  type OrganizationSurfaceContext,
} from '@/lib/organizations/surface'
import { getOrganizationHomeRedirect } from '@/app/o/[organizationId]/home/home-redirect'
import { HomeConversation } from '@/platform/app/(shell)/home/_components/home-conversation/home-conversation'
import { HomeDashboardSkeleton } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'
import { prefetchHome } from '@/platform/lib/data/prefetch-home'

export const metadata: Metadata = {
  title: 'Home',
}

interface PrefetchedHomeProps {
  surface: OrganizationSurfaceContext
  principal: SessionPrincipal
  requestMode: 'agent' | 'assistant'
}

/** Holds only its own boundary, so the page's arrangement paints before these reads settle. */
async function PrefetchedHome({ surface, principal, requestMode }: PrefetchedHomeProps) {
  return (
    <HydrationBoundary state={await prefetchHome(surface, principal)}>
      <HomeConversation requestMode={requestMode} />
    </HydrationBoundary>
  )
}

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  const homeRedirect = getOrganizationHomeRedirect(context, organizationId)
  if (homeRedirect) redirect(homeRedirect)

  const requestMode = context.canBuild ? 'agent' : 'assistant'
  return (
    <Suspense fallback={<HomeDashboardSkeleton requestMode={requestMode} />}>
      <PrefetchedHome
        surface={context}
        principal={{ kind: 'session', userId: session.user.id, sessionId: session.session.id }}
        requestMode={requestMode}
      />
    </Suspense>
  )
}
