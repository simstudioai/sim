import type { ReactNode } from 'react'
import styles from '#emcn/components/activity-row/activity-row.module.css'

interface ActivityBodyProps {
  children: ReactNode
  leading?: ReactNode
  decorativeLeading?: boolean
}

export function ActivityBody({ children, leading, decorativeLeading }: ActivityBodyProps) {
  return (
    <span className={styles.body}>
      {leading && (
        <span className={styles.leading} aria-hidden={decorativeLeading}>
          {leading}
        </span>
      )}
      <span className={styles.copy}>{children}</span>
    </span>
  )
}
