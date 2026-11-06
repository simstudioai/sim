import { PeopleFrame } from '@/platform/app/(shell)/people/_components/people-page/people-frame'
import { LoadingRows } from '@/platform/design-system/components'

export function PeopleSkeleton() {
  return (
    <PeopleFrame>
      <LoadingRows label='Loading people…' />
    </PeopleFrame>
  )
}
