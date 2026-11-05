import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/people/_components/people-page/people-page.module.css'

interface PeopleFrameProps {
  title?: string
  actions?: ReactNode
  /** Replaces the page body while the route's first read is pending, in the same geometry. */
  loading?: string
  children?: ReactNode
}

export function PeopleFrame({ title = 'People', actions, loading, children }: PeopleFrameProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 data-type='T076'>{title}</h1>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {loading ? (
        <p className={styles.status} role='status' data-type='T060'>
          {loading}
        </p>
      ) : (
        children
      )}
    </main>
  )
}
