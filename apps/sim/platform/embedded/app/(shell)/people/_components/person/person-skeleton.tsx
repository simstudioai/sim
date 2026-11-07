import { LoadingRows } from '@sim/emcn/status/query-boundary'
import styles from '@/platform/embedded/app/(shell)/people/_components/person/person.module.css'

/** A profile's frame while the route loads, with room where its way back will appear. */
export function PersonSkeleton() {
  return (
    <main className={styles.page}>
      <div className={styles.nav} />
      <LoadingRows label='Loading profile…' />
    </main>
  )
}
