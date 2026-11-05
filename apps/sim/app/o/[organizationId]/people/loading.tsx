import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { PeopleSkeleton } from '@/platform/app/(shell)/people/_components/people-page/people-skeleton'

export default function PeopleLoading() {
  return (
    <RedesignPageSurface>
      <PeopleSkeleton />
    </RedesignPageSurface>
  )
}
