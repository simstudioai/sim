import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { PeoplePage as PeopleView } from '@/platform/app/(shell)/people/_components/people-page/people-page'
import { PeopleSkeleton } from '@/platform/app/(shell)/people/_components/people-page/people-skeleton'

export const metadata: Metadata = { title: 'People' }

interface PeoplePageProps {
  params: Promise<{ organizationId: string }>
}

export default async function PeoplePage({ params }: PeoplePageProps) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).people,
        isInviteFlow: false,
      })
    )
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context || !(await canBrowsePeople(organizationId, context.viewer.role))) notFound()
  return (
    <RedesignPageSurface>
      <Suspense fallback={<PeopleSkeleton />}>
        <PeopleView organizationId={organizationId} />
      </Suspense>
    </RedesignPageSurface>
  )
}
