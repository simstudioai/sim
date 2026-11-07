import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { PeopleFrame } from '@/platform/embedded/app/(shell)/people/_components/people-page/people-frame'
import styles from '@/platform/embedded/app/(shell)/people/_components/people-page/people-page.module.css'

export function PeopleSkeleton() {
  return (
    <PeopleFrame>
      <div className={styles.loading}>
        <LoadingRows label='Loading people…' />
      </div>
    </PeopleFrame>
  )
}
