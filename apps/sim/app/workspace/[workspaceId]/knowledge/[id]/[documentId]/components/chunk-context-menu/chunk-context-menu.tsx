'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

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
}

/**
 * Context menu for chunks table.
 * Shows chunk actions when right-clicking a row, or "Create chunk" when right-clicking empty space.
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
}: ChunkContextMenuProps) {
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
        {hasChunk ? (
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
            {onEdit && (
              <PopoverItem
                onClick={() => {
                  onEdit()
                  onClose()
                }}
              >
                Edit
              </PopoverItem>
            )}
            {onCopyContent && (
              <PopoverItem
                onClick={() => {
                  onCopyContent()
                  onClose()
                }}
              >
                Copy content
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
                {isChunkEnabled ? 'Disable' : 'Enable'}
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
