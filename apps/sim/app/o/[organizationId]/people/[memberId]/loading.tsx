import { PageSurface } from '@/platform/design-system/components/surface/surface'
import { PersonSkeleton } from '@/platform/embedded/app/(shell)/people/_components/person/person-skeleton'

export default function PersonLoading() {
  return (
    <PageSurface>
      <PersonSkeleton />
    </PageSurface>
  )
}
