'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface DocumentContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  /**
   * Document-specific actions (shown when right-clicking on a document)
   */
  onOpenInNewTab?: () => void
  onToggleEnabled?: () => void
  onViewTags?: () => void
  onDelete?: () => void
  /**
   * Empty space action (shown when right-clicking on empty space)
   */
  onAddDocument?: () => void
  /**
   * Whether the document is currently enabled
   */
  isDocumentEnabled?: boolean
  /**
   * Whether a document is selected (vs empty space)
   */
  hasDocument: boolean
  /**
   * Whether the document has tags to view
   */
  hasTags?: boolean
  /**
   * Whether toggle enabled is disabled
   */
  disableToggleEnabled?: boolean
  /**
   * Whether delete is disabled
   */
  disableDelete?: boolean
  /**
   * Whether add document is disabled
   */
  disableAddDocument?: boolean
}

/**
 * Context menu for documents table.
 * Shows document actions when right-clicking a row, or "Add Document" when right-clicking empty space.
 */
export function DocumentContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onToggleEnabled,
  onViewTags,
  onDelete,
  onAddDocument,
  isDocumentEnabled = true,
  hasDocument,
  hasTags = false,
  disableToggleEnabled = false,
  disableDelete = false,
  disableAddDocument = false,
}: DocumentContextMenuProps) {
  return (
    <Popover open={isOpen} onOpenChange={onClose} variant='secondary' size='sm'>
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
        {hasDocument ? (
          <>
            {onOpenInNewTab && (
              <PopoverItem
                onClick={() => {
                  onOpenInNewTab()
                  onClose()
                }}
              >
                Open in new tab
              </PopoverItem>
            )}
            {hasTags && onViewTags && (
              <PopoverItem
                onClick={() => {
                  onViewTags()
                  onClose()
                }}
              >
                View tags
              </PopoverItem>
            )}
            {onToggleEnabled && (
              <PopoverItem
                disabled={disableToggleEnabled}
                onClick={() => {
                  onToggleEnabled()
                  onClose()
                }}
              >
                {isDocumentEnabled ? 'Disable' : 'Enable'}
              </PopoverItem>
            )}
            {onDelete && (
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
          </>
        ) : (
          onAddDocument && (
            <PopoverItem
              disabled={disableAddDocument}
              onClick={() => {
                onAddDocument()
                onClose()
              }}
            >
              Add document
            </PopoverItem>
          )
        )}
      </PopoverContent>
    </Popover>
  )
}
