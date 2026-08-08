'use client'

import type { ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@sim/emcn'

interface AnchoredContextMenuProps {
  isOpen: boolean
  /** Viewport coordinates of the pointer, e.g. from `useContextMenu`. */
  position: { x: number; y: number }
  onClose: () => void
  /** Gap in px between the pointer anchor and the menu. */
  sideOffset?: number
  /**
   * Layout/sizing only, for menus whose labels do not fit the 220px default
   * (e.g. the table's row-scoped workflow actions, which name both the action
   * and the selected row count). The shell still owns every other piece of
   * chrome — do not pass border, fill, radius or focus styling here.
   */
  contentClassName?: string
  /** The menu body — `DropdownMenuItem`s / `DropdownMenuSeparator`s. */
  children: ReactNode
}

/**
 * Pointer-anchored right-click menu shell: a `DropdownMenu` opened at a fixed
 * viewport position through an invisible zero-size trigger. The canonical
 * shell for every list/row context menu — consumers supply only the items.
 */
export function AnchoredContextMenu({
  isOpen,
  position,
  onClose,
  sideOffset = 4,
  contentClassName,
  children,
}: AnchoredContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          className='pointer-events-none fixed size-px'
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={sideOffset}
        className={contentClassName}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
