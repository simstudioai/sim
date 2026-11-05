import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/empty-state/empty-state.module.css'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className={styles.empty} data-action={action ? true : undefined}>
      <div>
        <h2 data-type='T042'>{title}</h2>
        {description && <p data-type='T067'>{description}</p>}
      </div>
      {action}
    </section>
  )
}
