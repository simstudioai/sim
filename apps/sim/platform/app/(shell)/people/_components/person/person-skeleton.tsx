import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/person/person.module.css'
import { Button } from '@/platform/design-system/components'

/** A profile's frame while the route loads: its way back and where the profile will appear. */
export function PersonSkeleton() {
  return (
    <main className={styles.page}>
      <div className={styles.nav}>
        <Button variant='quiet' icon='I023' render={<Link href='/people' />}>
          People
        </Button>
      </div>
      <p className={styles.secondary} role='status' data-type='T060'>
        Loading…
      </p>
    </main>
  )
}
