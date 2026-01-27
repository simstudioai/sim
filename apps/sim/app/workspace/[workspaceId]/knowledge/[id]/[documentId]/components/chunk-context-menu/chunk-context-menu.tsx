'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface ChunkContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  /**
   * Chunk-specific actions (shown when right-clicking on a chunk)
   */
  onOpenInNewTab?: () => void
  onEdit?: () => void
  onCopyContent?: () => void
  onToggleEnabled?: () => void
  onDelete?: () => void
  /**
   * Empty space action (shown when right-clicking on empty space)
   */
  onAddChunk?: () => void
  /**
   * Whether the chunk is currently enabled
   */
  isChunkEnabled?: boolean
  /**
   * Whether a chunk is selected (vs empty space)
   */
  hasChunk: boolean
  /**
   * Whether toggle enabled is disabled
   */
  disableToggleEnabled?: boolean
  /**
   * Whether delete is disabled
   */
  disableDelete?: boolean
  /**
   * Whether add chunk is disabled
   */
  disableAddChunk?: boolean
  /**
   * Number of selected chunks (for batch operations)
   */
  selectedCount?: number
  /**
   * Number of enabled chunks in selection
   */
  enabledCount?: number
  /**
   * Number of disabled chunks in selection
   */
  disabledCount?: number
}

/**
 * Context menu for chunks table.
 * Shows chunk actions when right-clicking a row, or "Create chunk" when right-clicking empty space.
 * Supports batch operations when multiple chunks are selected.
 */
export function ChunkContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onEdit,
  onCopyContent,
  onToggleEnabled,
  onDelete,
  onAddChunk,
  isChunkEnabled = true,
  hasChunk,
  disableToggleEnabled = false,
  disableDelete = false,
  disableAddChunk = false,
  selectedCount = 1,
  enabledCount = 0,
  disabledCount = 0,
}: ChunkContextMenuProps) {
  const isMultiSelect = selectedCount > 1

  const getToggleLabel = () => {
    if (isMultiSelect) {
      if (disabledCount > 0) return 'Enable'
      return 'Disable'
    }
    return isChunkEnabled ? 'Disable' : 'Enable'
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
        {hasChunk ? (
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

            {/* Edit and copy actions */}
            {!isMultiSelect && onEdit && (
              <PopoverItem
                onClick={() => {
                  onEdit()
                  onClose()
                }}
              >
                Edit
              </PopoverItem>
            )}
            {!isMultiSelect && onCopyContent && (
              <PopoverItem
                onClick={() => {
                  onCopyContent()
                  onClose()
                }}
              >
                Copy content
              </PopoverItem>
            )}
            {!isMultiSelect && (onEdit || onCopyContent) && <PopoverDivider />}

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
                (!isMultiSelect && onEdit) ||
                (!isMultiSelect && onCopyContent) ||
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
          onAddChunk && (
            <PopoverItem
              disabled={disableAddChunk}
              onClick={() => {
                onAddChunk()
                onClose()
              }}
            >
              Create chunk
            </PopoverItem>
          )
        )}
      </PopoverContent>
    </Popover>
  )
}
