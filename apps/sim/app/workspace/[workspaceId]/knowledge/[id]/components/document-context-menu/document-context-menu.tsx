'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface DocumentContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  /**
   * Document-specific actions (shown when right-clicking on a document)
   */
  onOpenInNewTab?: () => void
  onRename?: () => void
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
  /**
   * Number of selected documents (for batch operations)
   */
  selectedCount?: number
  /**
   * Number of enabled documents in selection
   */
  enabledCount?: number
  /**
   * Number of disabled documents in selection
   */
  disabledCount?: number
}

/**
 * Context menu for documents table.
 * Shows document actions when right-clicking a row, or "Add Document" when right-clicking empty space.
 * Supports batch operations when multiple documents are selected.
 */
export function DocumentContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onRename,
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
  selectedCount = 1,
  enabledCount = 0,
  disabledCount = 0,
}: DocumentContextMenuProps) {
  const isMultiSelect = selectedCount > 1

  const getToggleLabel = () => {
    if (isMultiSelect) {
      if (disabledCount > 0) return 'Enable'
      return 'Disable'
    }
    return isDocumentEnabled ? 'Disable' : 'Enable'
  }

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
        {hasDocument ? (
          <>
            {/* Navigation */}
            {!isMultiSelect && onOpenInNewTab && (
              <PopoverItem
                onClick={() => {
                  onOpenInNewTab()
                  onClose()
                }}
              >
                Open in new tab
              </PopoverItem>
            )}
            {!isMultiSelect && onOpenInNewTab && <PopoverDivider />}

            {/* Edit and view actions */}
            {!isMultiSelect && onRename && (
              <PopoverItem
                onClick={() => {
                  onRename()
                  onClose()
                }}
              >
                Rename
              </PopoverItem>
            )}
            {!isMultiSelect && hasTags && onViewTags && (
              <PopoverItem
                onClick={() => {
                  onViewTags()
                  onClose()
                }}
              >
                View tags
              </PopoverItem>
            )}
            {!isMultiSelect && (onRename || (hasTags && onViewTags)) && <PopoverDivider />}

            {/* State toggle */}
            {onToggleEnabled && (
              <PopoverItem
                disabled={disableToggleEnabled}
                onClick={() => {
                  onToggleEnabled()
                  onClose()
                }}
              >
                {getToggleLabel()}
              </PopoverItem>
            )}

            {/* Destructive action */}
            {onDelete &&
              ((!isMultiSelect && onOpenInNewTab) ||
                (!isMultiSelect && onRename) ||
                (!isMultiSelect && hasTags && onViewTags) ||
                onToggleEnabled) && <PopoverDivider />}
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
