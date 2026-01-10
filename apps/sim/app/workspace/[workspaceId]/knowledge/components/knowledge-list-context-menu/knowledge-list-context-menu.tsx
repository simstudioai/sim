'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface KnowledgeListContextMenuProps {
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
   * Callback when add knowledge base is clicked
   */
  onAddKnowledgeBase?: () => void
  /**
   * Whether the add option is disabled
   * @default false
   */
  disableAdd?: boolean
}

/**
 * Context menu component for the knowledge base list page.
 * Displays "Add knowledge base" option when right-clicking on empty space.
 */
export function KnowledgeListContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onAddKnowledgeBase,
  disableAdd = false,
}: KnowledgeListContextMenuProps) {
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
        {onAddKnowledgeBase && (
          <PopoverItem
            disabled={disableAdd}
            onClick={() => {
              onAddKnowledgeBase()
              onClose()
            }}
          >
            Add knowledge base
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
