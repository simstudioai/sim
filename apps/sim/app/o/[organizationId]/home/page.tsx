import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationHomeRedirect } from '@/lib/organizations/home-redirect'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { HomeConversation } from '@/platform/app/(shell)/home/_components/home-conversation/home-conversation'
import { HomeDashboardSkeleton } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'
import { Hydrated } from '@/platform/design-system/components/surface/hydrated'
import { prefetchHome } from '@/platform/lib/data/prefetch-member-inventory'

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
    <Suspense fallback={<HomeDashboardSkeleton requestMode={requestMode} />}>
      <Hydrated state={prefetchHome(context, principal)}>
        <HomeConversation requestMode={requestMode} />
      </Hydrated>
    </Suspense>
  )
}
