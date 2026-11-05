'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import styles from '@/platform/app/(shell)/people/_components/person/person.module.css'
import { Button } from '@/platform/design-system/components'

/** A profile's frame while the route loads: its way back and where the profile will appear. */
export function PersonSkeleton() {
  const { organizationId } = useParams<{ organizationId: string }>()
  return (
    <main className={styles.page}>
      <div className={styles.nav}>
        <Button
          variant='quiet'
          icon='I093'
          render={<Link href={organizationRoutes(organizationId).people} />}
        >
          People
        </Button>
      </div>
      <p className={styles.secondary} role='status' data-type='T060'>
        Loading…
      </p>
    </main>
  )
}
