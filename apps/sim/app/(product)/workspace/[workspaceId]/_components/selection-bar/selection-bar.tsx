import type { ReactNode } from 'react'
import { OverflowText } from '@sim/emcn/overflow-text'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/selection-bar/selection-bar.module.css'

interface SelectionBarProps {
  /** What is selected, such as "3 selected"; it gives way before the actions on a narrow surface. */
  label: string
  /** Names the toolbar, so several selection bars on one page stay distinct. */
  'aria-label': string
  /** The selection's commands, in the order their row menu lists them. */
  children: ReactNode
}

/**
 * The floating bar that carries a selection's count and commands. The caller places it: sticky at
 * a list's foot, or over a grid's bottom edge.
 */
export function SelectionBar({ label, 'aria-label': ariaLabel, children }: SelectionBarProps) {
  return (
    <div
      className={styles.bar}
      role='toolbar'
      aria-label={ariaLabel}
      data-material='floating'
      data-elevation='menu'
    >
      <span className={styles.label} data-type='T060' role='status'>
        <OverflowText text={label}>{label}</OverflowText>
      </span>
      <span className={styles.actions}>{children}</span>
    </div>
  )
}
