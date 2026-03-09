'use client'

import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface PreviewContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onCopy: () => void
  onSearch?: () => void
  wrapText?: boolean
  onToggleWrap?: () => void
  /** When true, only shows Copy option (for subblock values) */
  copyOnly?: boolean
}

/**
 * Context menu for preview editor sidebar.
 * Provides copy, search, and display options.
 * Uses createPortal to render outside any transformed containers (like modals).
 */
export function PreviewContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onCopy,
  onSearch,
  wrapText,
  onToggleWrap,
  copyOnly = false,
}: PreviewContextMenuProps) {
  if (typeof document === 'undefined') return null

  return createPortal(
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
        <PopoverItem
          onClick={() => {
            onCopy()
            onClose()
          }}
        >
          Copy
        </PopoverItem>

        {!copyOnly && onSearch && (
          <>
            <PopoverDivider />
            <PopoverItem
              onClick={() => {
                onSearch()
                onClose()
              }}
            >
              Search
            </PopoverItem>
          </>
        )}

        {!copyOnly && onToggleWrap && (
          <>
            <PopoverDivider />
            <PopoverItem showCheck={wrapText} onClick={onToggleWrap}>
              Wrap Text
            </PopoverItem>
          </>
        )}
      </PopoverContent>
    </Popover>,
    document.body
  )
}
