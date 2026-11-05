import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { PersonSkeleton } from '@/platform/app/(shell)/people/_components/person/person-skeleton'

export default function PersonLoading() {
  return (
    <RedesignPageSurface>
      <PersonSkeleton />
    </RedesignPageSurface>
  )
}
