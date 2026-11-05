import { PeopleFrame } from '@/platform/app/(shell)/people/_components/people-page/people-frame'
import styles from '@/platform/app/(shell)/people/_components/people-page/people-page.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'

/** The page before its first read, with the view switch's place held. */
export function PeopleSkeleton() {
  return (
    <PeopleFrame>
      <div className={styles.viewsPlaceholder} aria-hidden='true' />
      <PeopleStatus>Loading people…</PeopleStatus>
    </PeopleFrame>
  )
}
