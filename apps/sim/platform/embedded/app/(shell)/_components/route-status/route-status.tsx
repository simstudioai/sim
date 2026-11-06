import type { ReactNode } from 'react'
import { PageSurface } from '@/platform/design-system/components/surface/surface'
import styles from '@/platform/embedded/app/(shell)/_components/route-status/route-status.module.css'

interface RouteStatusProps {
  title: string
  description: string
  /** Announces the description as a passing state, for a route still on its way. */
  loading?: boolean
  actions?: ReactNode
}

/**
 * A whole route's answer: not found, failed, refused or loading. An error boundary renders this, so
 * it reads no provider, store or query, and its controls are plain links and buttons.
 */
export function RouteStatus({ title, description, loading, actions }: RouteStatusProps) {
  return (
    <PageSurface>
      <div className={styles.frame}>
        <div className={styles.content}>
          <div className={styles.copy}>
            <h1 data-type='T076'>{title}</h1>
            <p data-type='T048' role={loading ? 'status' : undefined}>
              {description}
            </p>
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </div>
    </PageSurface>
  )
}
