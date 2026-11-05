import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/people/_components/people-page/people-page.module.css'

interface PeopleFrameProps {
  actions?: ReactNode
  children?: ReactNode
}

export function PeopleFrame({ actions, children }: PeopleFrameProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 data-type='T076'>People</h1>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </main>
  )
}
