import { PeopleSurface } from '@/app/o/[organizationId]/people/people-surface'
import { PeopleSkeleton } from '@/platform/app/(shell)/people/_components/people-page/people-skeleton'

export default function PeopleLoading() {
  return (
    <PeopleSurface>
      <PeopleSkeleton />
    </PeopleSurface>
  )
}
