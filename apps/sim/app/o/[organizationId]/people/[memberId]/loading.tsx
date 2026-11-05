import { PeopleSurface } from '@/app/o/[organizationId]/people/people-surface'
import { PersonSkeleton } from '@/platform/app/(shell)/people/_components/person/person-skeleton'

export default function PersonLoading() {
  return (
    <PeopleSurface>
      <PersonSkeleton />
    </PeopleSurface>
  )
}
