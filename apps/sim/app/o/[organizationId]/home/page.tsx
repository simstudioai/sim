import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationHomeRedirect } from '@/lib/organizations/home-redirect'
import { Hydrated } from '@/app/o/[organizationId]/components/hydrated'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { HomeConversation } from '@/platform/embedded/app/(shell)/home/_components/home-conversation/home-conversation'
import { HomeDashboardSkeleton } from '@/platform/embedded/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'
import { prefetchHome } from '@/platform/embedded/lib/data/prefetch-member-inventory'

export const metadata: Metadata = {
  title: 'Home',
}

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const { principal, surface: context } = await requireOrganizationViewer(
    organizationId,
    organizationRoutes(organizationId).home
  )
  const homeRedirect = getOrganizationHomeRedirect(context, organizationId)
  if (homeRedirect) redirect(homeRedirect)

  const requestMode = context.canBuild ? 'agent' : 'assistant'
  return (
    <Suspense fallback={<HomeDashboardSkeleton />}>
      <Hydrated state={prefetchHome(context, principal)}>
        <HomeConversation requestMode={requestMode} />
      </Hydrated>
    </Suspense>
  )
}
