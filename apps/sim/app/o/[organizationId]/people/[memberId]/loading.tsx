import { PersonSkeleton } from '@/platform/app/(shell)/people/_components/person/person-skeleton'
import { PageSurface } from '@/platform/design-system/components/surface/surface'

export default function PersonLoading() {
  return (
    <PageSurface>
      <PersonSkeleton />
    </PageSurface>
  )
}
