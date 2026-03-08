'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface TablesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onCreateTable?: () => void
  disableCreate?: boolean
}

export function TablesListContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onCreateTable,
  disableCreate = false,
}: TablesListContextMenuProps) {
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
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
        {onCreateTable && (
          <PopoverItem
            disabled={disableCreate}
            onClick={() => {
              onCreateTable()
              onClose()
            }}
          >
            Create table
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
