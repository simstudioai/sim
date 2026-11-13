'use client'

import { DropdownMenuItem, DropdownMenuShortcut } from '@sim/emcn'
import { formatShortcut } from '@/lib/core/utils/platform'

interface ResourceZoomMenuItemsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onActualSize: () => void
}

/** Shared zoom commands used by Browser and Terminal resource menus. */
export function ResourceZoomMenuItems({
  onZoomIn,
  onZoomOut,
  onActualSize,
}: ResourceZoomMenuItemsProps) {
  return (
    <>
      <DropdownMenuItem onSelect={onZoomIn}>
        Zoom In
        <DropdownMenuShortcut>{formatShortcut('+')}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onZoomOut}>
        Zoom Out
        <DropdownMenuShortcut>{formatShortcut('−')}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onActualSize}>
        Actual Size
        <DropdownMenuShortcut>{formatShortcut('0')}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  )
}
