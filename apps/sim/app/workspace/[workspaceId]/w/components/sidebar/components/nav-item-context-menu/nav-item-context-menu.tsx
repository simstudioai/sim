'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface NavItemContextMenuProps {
  /**
   * Whether the context menu is open
   */
  isOpen: boolean
  /**
   * Position of the context menu
   */
  position: { x: number; y: number }
  /**
   * Ref for the menu element
   */
  menuRef: React.RefObject<HTMLDivElement | null>
  /**
   * Callback when menu should close
   */
  onClose: () => void
  /**
   * Callback when open in new tab is clicked
   */
  onOpenInNewTab: () => void
  /**
   * Callback when copy link is clicked
   */
  onCopyLink: () => void
}

/**
 * Context menu component for sidebar navigation items.
 * Displays navigation-appropriate options (open in new tab, copy link) in a popover at the right-click position.
 */
export function NavItemContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onCopyLink,
}: NavItemContextMenuProps) {
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
        <PopoverItem
          onClick={() => {
            onOpenInNewTab()
            onClose()
          }}
        >
          Open in new tab
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onCopyLink()
            onClose()
          }}
        >
          Copy link
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
