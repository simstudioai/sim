'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface NavItemContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onOpenInNewTab: () => void
  onCopyLink: () => void
  onRename?: () => void
  onDelete?: () => void
}

export function NavItemContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onCopyLink,
  onRename,
  onDelete,
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
        {onRename && (
          <PopoverItem
            onClick={() => {
              onRename()
              onClose()
            }}
          >
            Rename
          </PopoverItem>
        )}
        {onDelete && (
          <PopoverItem
            onClick={() => {
              onDelete()
              onClose()
            }}
            className='text-[var(--color-error)]'
          >
            Delete
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
