import { LoadingRows } from '@/platform/design-system/components'
import { PeopleFrame } from '@/platform/embedded/app/(shell)/people/_components/people-page/people-frame'

export function PeopleSkeleton() {
  return (
    <PeopleFrame>
      <LoadingRows label='Loading people…' />
    </PeopleFrame>
  )
}
