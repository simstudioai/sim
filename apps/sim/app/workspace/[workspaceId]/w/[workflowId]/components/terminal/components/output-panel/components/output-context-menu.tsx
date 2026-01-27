'use client'

import type { RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface ContextMenuPosition {
  x: number
  y: number
}

interface OutputContextMenuProps {
  isOpen: boolean
  position: ContextMenuPosition
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onCopySelection: () => void
  onCopyAll: () => void
  onSearch: () => void
  wrapText: boolean
  onToggleWrap: () => void
  openOnRun: boolean
  onToggleOpenOnRun: () => void
  onClearConsole: () => void
  hasSelection: boolean
}

/**
 * Context menu for terminal output panel (right side).
 * Displays copy, search, and display options for the code viewer.
 */
export function OutputContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onCopySelection,
  onCopyAll,
  onSearch,
  wrapText,
  onToggleWrap,
  openOnRun,
  onToggleOpenOnRun,
  onClearConsole,
  hasSelection,
}: OutputContextMenuProps) {
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        {/* Copy and search actions */}
        <PopoverItem
          disabled={!hasSelection}
          onClick={() => {
            onCopySelection()
            onClose()
          }}
        >
          Copy Selection
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onCopyAll()
            onClose()
          }}
        >
          Copy All
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onSearch()
            onClose()
          }}
        >
          Search
        </PopoverItem>

        {/* Display settings - toggles don't close menu */}
        <PopoverDivider />
        <PopoverItem showCheck={wrapText} onClick={onToggleWrap}>
          Wrap Text
        </PopoverItem>
        <PopoverItem showCheck={openOnRun} onClick={onToggleOpenOnRun}>
          Open on Run
        </PopoverItem>

        {/* Destructive action */}
        <PopoverDivider />
        <PopoverItem
          onClick={() => {
            onClearConsole()
            onClose()
          }}
        >
          Clear Console
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
