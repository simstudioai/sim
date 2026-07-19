'use client'

import { DropdownMenuItem, DropdownMenuSeparator } from '@sim/emcn'
import { Duplicate, Eye, Pencil, Plus, SquareArrowUpRight, Trash } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface ChunkContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onEdit?: () => void
  onCopyContent?: () => void
  onToggleEnabled?: () => void
  onDelete?: () => void
  onAddChunk?: () => void
  isChunkEnabled?: boolean
  hasChunk: boolean
  disableToggleEnabled?: boolean
  disableDelete?: boolean
  disableAddChunk?: boolean
  disableEdit?: boolean
  isConnectorDocument?: boolean
  selectedCount?: number
  enabledCount?: number
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
  disableEdit = false,
  isConnectorDocument = false,
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

  /**
   * Canonical resource-menu structure: navigation (Open in new tab) above a
   * single separator, then the item actions in the shared order — Edit, Copy
   * content, Enable/Disable, Delete.
   */
  const hasNavigationSection = !isMultiSelect && !!onOpenInNewTab
  const hasActionsSection =
    (!isMultiSelect && (!!onEdit || !!onCopyContent)) || !!onToggleEnabled || !!onDelete

  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {hasChunk ? (
        <>
          {hasNavigationSection && (
            <DropdownMenuItem onSelect={onOpenInNewTab!}>
              <SquareArrowUpRight />
              Open in new tab
            </DropdownMenuItem>
          )}
          {hasNavigationSection && hasActionsSection && <DropdownMenuSeparator />}
          {!isMultiSelect && onEdit && (
            <DropdownMenuItem disabled={disableEdit} onSelect={onEdit}>
              <Pencil />
              {isConnectorDocument ? 'View' : 'Edit'}
            </DropdownMenuItem>
          )}
          {!isMultiSelect && onCopyContent && (
            <DropdownMenuItem onSelect={onCopyContent}>
              <Duplicate />
              Copy content
            </DropdownMenuItem>
          )}
          {onToggleEnabled && (
            <DropdownMenuItem disabled={disableToggleEnabled} onSelect={onToggleEnabled}>
              <Eye />
              {getToggleLabel()}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
              <Trash />
              Delete
            </DropdownMenuItem>
          )}
        </>
      ) : (
        onAddChunk && (
          <DropdownMenuItem disabled={disableAddChunk} onSelect={onAddChunk}>
            <Plus />
            Create chunk
          </DropdownMenuItem>
        )
      )}
    </AnchoredContextMenu>
  )
}
