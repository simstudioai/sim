import { PeopleFrame } from '@/platform/app/(shell)/people/_components/people-page/people-frame'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'

export function PeopleSkeleton() {
  return (
    <PeopleFrame>
      <PeopleStatus>Loading people…</PeopleStatus>
    </PeopleFrame>
  )
}
