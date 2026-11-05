import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { PersonProfile } from '@/platform/app/(shell)/people/_components/person/person'
import { PersonSkeleton } from '@/platform/app/(shell)/people/_components/person/person-skeleton'

export const metadata: Metadata = { title: 'People' }

interface PersonPageProps {
  params: Promise<{ organizationId: string; memberId: string }>
}

export default async function PersonPage({ params }: PersonPageProps) {
  const { organizationId, memberId } = await params
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).person(memberId),
        isInviteFlow: false,
      })
    )
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context || !(await canBrowsePeople(organizationId, context.viewer.role))) notFound()
  return (
    <RedesignPageSurface>
      <Suspense fallback={<PersonSkeleton />}>
        <PersonProfile organizationId={organizationId} memberId={memberId} />
      </Suspense>
    </RedesignPageSurface>
  )
}
