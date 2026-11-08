'use client'

import { useLayoutEffect, useRef } from 'react'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'

/** A menu the grid opens at a viewport point: under a header, or where a cell was right-clicked. */
export interface GridMenu {
  label: string
  x: number
  y: number
  actions: readonly MenuAction[] | (() => readonly MenuAction[])
}

interface PointMenuProps {
  menu: GridMenu | null
  onClose: () => void
}

/**
 * The grid's one floating menu. The shared action menu anchors its popup to a trigger, so this keeps
 * that trigger invisible and moves it to the requested point, lifted by its own height so the popup
 * opens exactly at the point, as a native context menu does.
 */
export function PointMenu({ menu, onClose }: PointMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = anchor.current
    if (!element || !menu) return
    const height = element.firstElementChild?.getBoundingClientRect().height ?? 0
    element.style.setProperty('left', `${menu.x}px`)
    element.style.setProperty('top', `${menu.y - height}px`)
  }, [menu])
  return (
    <span ref={anchor} className={styles.pointAnchor} aria-hidden={menu ? undefined : true}>
      <ActionMenu
        label={menu?.label ?? 'Table actions'}
        icon='I108'
        tooltip={false}
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        actions={menu?.actions ?? NO_ACTIONS}
      />
    </span>
  )
}

const NO_ACTIONS: readonly MenuAction[] = []
