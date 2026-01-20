'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface EmptyAreaContextMenuProps {
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
   * Callback when create workflow is clicked
   */
  onCreateWorkflow: () => void
  /**
   * Callback when create folder is clicked
   */
  onCreateFolder: () => void
  /**
   * Whether create workflow is disabled
   */
  disableCreateWorkflow?: boolean
  /**
   * Whether create folder is disabled
   */
  disableCreateFolder?: boolean
}

/**
 * Context menu component for sidebar empty area.
 * Displays options to create a workflow or folder when right-clicking on empty space.
 */
export function EmptyAreaContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onCreateWorkflow,
  onCreateFolder,
  disableCreateWorkflow = false,
  disableCreateFolder = false,
}: EmptyAreaContextMenuProps) {
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
          disabled={disableCreateWorkflow}
          onClick={() => {
            onCreateWorkflow()
            onClose()
          }}
        >
          Create workflow
        </PopoverItem>
        <PopoverItem
          disabled={disableCreateFolder}
          onClick={() => {
            onCreateFolder()
            onClose()
          }}
        >
          Create folder
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
