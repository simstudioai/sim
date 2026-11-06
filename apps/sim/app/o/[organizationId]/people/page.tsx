import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { PeoplePage as PeopleView } from '@/platform/app/(shell)/people/_components/people-page/people-page'
import { PeopleSkeleton } from '@/platform/app/(shell)/people/_components/people-page/people-skeleton'

export const metadata: Metadata = { title: 'People' }

interface PeoplePageProps {
  params: Promise<{ organizationId: string }>
}

export default async function PeoplePage({ params }: PeoplePageProps) {
  const { organizationId } = await params
  const { surface } = await requireOrganizationViewer(
    organizationId,
    organizationRoutes(organizationId).people
  )
  if (!(await canBrowsePeople(organizationId, surface.viewer.role))) notFound()
  return (
    <RedesignPageSurface>
      <Suspense fallback={<PeopleSkeleton />}>
        <PeopleView organizationId={organizationId} />
      </Suspense>
    </RedesignPageSurface>
  )
}
