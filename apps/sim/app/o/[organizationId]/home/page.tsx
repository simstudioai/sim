import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { HomeConversation } from '@/app/o/[organizationId]/_redesign/home/home-conversation'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { prefetchHome } from '@/app/o/[organizationId]/_redesign/prefetch-member-inventory'
import { getOrganizationHomeRedirect } from '@/app/o/[organizationId]/home/home-redirect'
import { HomeDashboardSkeleton } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'

export const metadata: Metadata = {
  title: 'Home',
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
      <Hydrated
        state={prefetchHome(context, {
          kind: 'session',
          userId: session.user.id,
          sessionId: session.session.id,
        })}
      >
        <HomeConversation requestMode={requestMode} />
      </Hydrated>
    </Suspense>
  )
}
