'use client'

import type { ReactNode } from 'react'
import { PageColumn } from '@sim/emcn-platform/page-column'
import styles from '@/platform/app/(shell)/people/_components/people-page/people-page.module.css'

type PeopleView = 'chart' | 'directory'

const VIEWS = [
  { value: 'chart', label: 'Org chart' },
  { value: 'directory', label: 'Directory' },
] as const

interface PeopleFrameProps {
  actions?: ReactNode
  view: PeopleView
  onViewChange: (view: PeopleView) => void
  children: ReactNode
}

/** The title, its actions and the view tabs, painted before the view's first read settles. */
export function PeopleFrame({ actions, view, onViewChange, children }: PeopleFrameProps) {
  return (
    <main className={styles.page}>
      <PageColumn>
        <header className={styles.header}>
          <h1 data-type='T076'>People</h1>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
        <nav className={styles.tabs} aria-label='People view'>
          {VIEWS.map(({ value, label }) => (
            <button
              key={value}
              type='button'
              className={styles.tab}
              data-type={view === value ? 'T042' : 'T043'}
              aria-current={view === value ? 'page' : undefined}
              onClick={() => onViewChange(value)}
            >
              {label}
            </button>
          ))}
        </nav>
      </PageColumn>
      <div className={styles.body}>{children}</div>
    </main>
  )
}
