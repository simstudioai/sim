import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/empty-state/empty-state.module.css'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  /** A decorative mark above the title. */
  graphic?: ReactNode
}

export function EmptyState({ title, description, action, graphic }: EmptyStateProps) {
  return (
    <section className={styles.empty} data-action={action ? true : undefined}>
      {graphic && (
        <span className={styles.graphic} aria-hidden='true'>
          {graphic}
        </span>
      )}
      <div className={styles.copy}>
        <h2 data-type='T042'>{title}</h2>
        {description && <p data-type='T067'>{description}</p>}
      </div>
      {action}
    </section>
  )
}
