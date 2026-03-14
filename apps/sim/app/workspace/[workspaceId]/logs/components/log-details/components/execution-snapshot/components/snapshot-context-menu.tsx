'use client'

import { createPortal } from 'react-dom'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Copy, Search } from '@/components/emcn/icons'

interface SnapshotContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCopy: () => void
  onSearch?: () => void
  wrapText?: boolean
  onToggleWrap?: () => void
  /** When true, only shows Copy option (for subblock values) */
  copyOnly?: boolean
}

/**
 * Context menu for execution snapshot sidebar.
 * Provides copy, search, and display options.
 * Uses createPortal to render outside any transformed containers (like modals).
 */
export function SnapshotContextMenu({
  isOpen,
  position,
  onClose,
  onCopy,
  onSearch,
  wrapText,
  onToggleWrap,
  copyOnly = false,
}: SnapshotContextMenuProps) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={onCopy}>
          <Copy />
          Copy
        </DropdownMenuItem>

        {!copyOnly && onSearch && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSearch}>
              <Search />
              Search
            </DropdownMenuItem>
          </>
        )}

        {!copyOnly && onToggleWrap && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={wrapText} onSelect={onToggleWrap}>
              Wrap Text
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>,
    document.body
  )
}
