import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { PageSurface } from '@/platform/design-system/components/surface/surface'
import { PersonProfile } from '@/platform/embedded/app/(shell)/people/_components/person/person'
import { PersonSkeleton } from '@/platform/embedded/app/(shell)/people/_components/person/person-skeleton'

export const metadata: Metadata = { title: 'People' }

interface PersonPageProps {
  params: Promise<{ organizationId: string; memberId: string }>
}

export default async function PersonPage({ params }: PersonPageProps) {
  const { organizationId, memberId } = await params
  const { surface } = await requireOrganizationViewer(
    organizationId,
    organizationRoutes(organizationId).person(memberId)
  )
  if (!(await canBrowsePeople(organizationId, surface.viewer.role))) notFound()
  return (
    <PageSurface>
      <Suspense fallback={<PersonSkeleton />}>
        <PersonProfile organizationId={organizationId} memberId={memberId} />
      </Suspense>
    </PageSurface>
  )
}
