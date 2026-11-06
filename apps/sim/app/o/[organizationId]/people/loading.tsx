import { PageSurface } from '@/platform/design-system/components/surface/surface'
import { PeopleSkeleton } from '@/platform/embedded/app/(shell)/people/_components/people-page/people-skeleton'

export default function PeopleLoading() {
  return (
    <PageSurface>
      <PeopleSkeleton />
    </PageSurface>
  )
}
