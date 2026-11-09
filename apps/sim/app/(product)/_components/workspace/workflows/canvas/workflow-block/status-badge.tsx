import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/status-badge.module.css'

/** The status colors the card's badges use. */
type StatusBadgeColor = 'red' | 'amber' | 'orange'

interface StatusBadgeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'> {
  color: StatusBadgeColor
  /** The cursor the legacy caller set: a pointer when clicking acts, not-allowed when it is gated. */
  cursor?: 'pointer' | 'not-allowed'
  children: ReactNode
}

/**
 * The legacy dotted status `Badge` (size md) the card paints in its header: sunset, child deploy,
 * disabled schedule or webhook, and the webhook trigger.
 */
export function StatusBadge({ color, cursor, children, ...props }: StatusBadgeProps) {
  return (
    <div
      className={cn(
        styles.badge,
        styles[color],
        cursor === 'pointer' && styles.pointer,
        cursor === 'not-allowed' && styles.notAllowed
      )}
      {...props}
    >
      <div className={styles.dot} />
      {children}
    </div>
  )
}
