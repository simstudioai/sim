'use client'

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/pointer-menu/pointer-menu.module.css'

interface PointerMenuProps {
  /** Names the menu for assistive technology. */
  label: string
  isOpen: boolean
  /** Viewport coordinates of the secondary click the menu opens at. */
  position: { x: number; y: number }
  /** Receives the open popup, so the caller's own outside-click check can tell its rows apart. */
  menuRef?: RefObject<HTMLDivElement | null>
  onClose: () => void
  /** Built only while the menu is open. */
  actions: () => readonly MenuAction[]
}

/**
 * EMCN's action menu, opened where the canvas measured a secondary click, as the legacy popover
 * was from a 1px fixed anchor. Its trigger is an invisible, zero-size point at that position, so
 * Base UI places, flips and dismisses the rows as it does for every other Platform menu while
 * the caller owns `isOpen`.
 */
export function PointerMenu({
  label,
  isOpen,
  position,
  menuRef,
  onClose,
  actions,
}: PointerMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const point = anchor.current
    if (!point) return
    point.style.left = `${position.x}px`
    point.style.top = `${position.y}px`
  }, [position.x, position.y])

  useEffect(() => {
    if (!isOpen || !menuRef) return
    const frame = requestAnimationFrame(() => {
      const controls = anchor.current
        ?.querySelector('[aria-controls]')
        ?.getAttribute('aria-controls')
      const popup = controls
        ? document.getElementById(controls)?.closest('[data-elevation="menu"]')
        : null
      menuRef.current = popup instanceof HTMLDivElement ? popup : null
    })
    return () => {
      cancelAnimationFrame(frame)
      menuRef.current = null
    }
  }, [isOpen, menuRef])

  return (
    <span ref={anchor} className={styles.point} aria-hidden='true'>
      <ActionMenu
        label={label}
        icon='I108'
        tooltip={false}
        actions={actions}
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      />
    </span>
  )
}
