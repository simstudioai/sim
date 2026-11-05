import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import styles from '@/platform/app/(shell)/people/_components/person/person.module.css'

/** A profile's frame while the route loads, with room where its way back will appear. */
export function PersonSkeleton() {
  return (
    <main className={styles.page}>
      <div className={styles.nav} />
      <PeopleStatus>Loading profile…</PeopleStatus>
    </main>
  )
}
