import { PeopleSkeleton } from '@/platform/app/(shell)/people/_components/people-page/people-skeleton'
import { PageSurface } from '@/platform/design-system/components/surface/surface'

export default function PeopleLoading() {
  return (
    <PageSurface>
      <PeopleSkeleton />
    </PageSurface>
  )
}
