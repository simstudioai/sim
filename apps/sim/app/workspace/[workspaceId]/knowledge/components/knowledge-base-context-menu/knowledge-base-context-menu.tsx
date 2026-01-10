'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface KnowledgeBaseContextMenuProps {
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
  onOpenInNewTab?: () => void
  /**
   * Callback when view tags is clicked
   */
  onViewTags?: () => void
  /**
   * Callback when copy ID is clicked
   */
  onCopyId?: () => void
  /**
   * Callback when edit is clicked
   */
  onEdit?: () => void
  /**
   * Callback when delete is clicked
   */
  onDelete?: () => void
  /**
   * Whether to show the open in new tab option
   * @default true
   */
  showOpenInNewTab?: boolean
  /**
   * Whether to show the view tags option
   * @default true
   */
  showViewTags?: boolean
  /**
   * Whether to show the edit option
   * @default true
   */
  showEdit?: boolean
  /**
   * Whether to show the delete option
   * @default true
   */
  showDelete?: boolean
  /**
   * Whether the edit option is disabled
   * @default false
   */
  disableEdit?: boolean
  /**
   * Whether the delete option is disabled
   * @default false
   */
  disableDelete?: boolean
}

/**
 * Context menu component for knowledge base cards.
 * Displays open in new tab, view tags, edit, and delete options in a popover at the right-click position.
 */
export function KnowledgeBaseContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onViewTags,
  onCopyId,
  onEdit,
  onDelete,
  showOpenInNewTab = true,
  showViewTags = true,
  showEdit = true,
  showDelete = true,
  disableEdit = false,
  disableDelete = false,
}: KnowledgeBaseContextMenuProps) {
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
        {/* Navigation */}
        {showOpenInNewTab && onOpenInNewTab && (
          <PopoverItem
            onClick={() => {
              onOpenInNewTab()
              onClose()
            }}
          >
            Open in new tab
          </PopoverItem>
        )}
        {showOpenInNewTab && onOpenInNewTab && <PopoverDivider />}

        {/* View and copy actions */}
        {showViewTags && onViewTags && (
          <PopoverItem
            onClick={() => {
              onViewTags()
              onClose()
            }}
          >
            View tags
          </PopoverItem>
        )}
        {onCopyId && (
          <PopoverItem
            onClick={() => {
              onCopyId()
              onClose()
            }}
          >
            Copy ID
          </PopoverItem>
        )}
        {((showViewTags && onViewTags) || onCopyId) && <PopoverDivider />}

        {/* Edit action */}
        {showEdit && onEdit && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onEdit()
              onClose()
            }}
          >
            Edit
          </PopoverItem>
        )}

        {/* Destructive action */}
        {showDelete &&
          onDelete &&
          ((showOpenInNewTab && onOpenInNewTab) ||
            (showViewTags && onViewTags) ||
            onCopyId ||
            (showEdit && onEdit)) && <PopoverDivider />}
        {showDelete && onDelete && (
          <PopoverItem
            disabled={disableDelete}
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            Delete
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
