import type { ReactElement, ReactNode } from 'react'
import { ControlRow } from '@sim/emcn/button/control-row'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu, ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import styles from '@/app/o/[organizationId]/_redesign/rail/sidebar-collections.module.css'

export function PinnedIndicator() {
  return (
    <span className={styles.indicator} role='img' aria-label='Pinned'>
      <Icon name='I131' />
    </span>
  )
}

interface SectionRowProps {
  label: string
  actions: readonly MenuAction[]
  /** The row's link, which owns its navigation and prefetching. */
  render: ReactElement
  leading?: ReactNode
  status?: ReactNode
  selected?: boolean
  onMenuOpenChange?: (open: boolean) => void
}

/** A row of the rail's collections. Its options button and a right click open the same menu. */
export function SectionRow({
  label,
  actions,
  render,
  leading,
  status,
  selected,
  onMenuOpenChange,
}: SectionRowProps) {
  const menuLabel = `Actions for ${label}`
  return (
    <ContextActionMenu label={menuLabel} actions={actions} onOpenChange={onMenuOpenChange}>
      <div className={styles.row} data-selected={selected || undefined}>
        <ControlRow
          label={label}
          leading={leading}
          status={status}
          action={
            <ActionMenu
              label={menuLabel}
              tooltip={false}
              icon='I108'
              triggerSize='compact'
              align='end'
              actions={actions}
              onOpenChange={onMenuOpenChange}
            />
          }
          render={render}
        />
      </div>
    </ContextActionMenu>
  )
}
