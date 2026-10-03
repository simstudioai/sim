'use client'

import { DropdownMenuItem, DropdownMenuShortcut } from '@sim/emcn'

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
        <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onZoomOut}>
        Zoom Out
        <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onActualSize}>
        Actual Size
        <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  )
}
