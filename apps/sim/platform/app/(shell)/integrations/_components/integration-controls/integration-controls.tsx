import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls.module.css'

interface IntegrationControlsProps {
  leading: ReactNode
  children?: ReactNode
}

export function IntegrationControls({ leading, children }: IntegrationControlsProps) {
  return (
    <div className={styles.controls}>
      <div className={styles.leading}>{leading}</div>
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  )
}
