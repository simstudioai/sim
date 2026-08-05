'use client'

import { DropdownMenuItem, DropdownMenuSeparator } from '@sim/emcn'
import { Eye, Pencil, Plus, SquareArrowUpRight, TagIcon, Trash } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface DocumentContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onOpenSource?: () => void
  onRename?: () => void
  onToggleEnabled?: () => void
  onViewTags?: () => void
  onDelete?: () => void
  onAddDocument?: () => void
  isDocumentEnabled?: boolean
  hasDocument: boolean
  disableRename?: boolean
  disableToggleEnabled?: boolean
  disableDelete?: boolean
  disableAddDocument?: boolean
  selectedCount?: number
  enabledCount?: number
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
  onClose,
  onOpenInNewTab,
  onOpenSource,
  onRename,
  onToggleEnabled,
  onViewTags,
  onDelete,
  onAddDocument,
  isDocumentEnabled = true,
  hasDocument,
  disableRename = false,
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

  /**
   * Canonical resource-menu structure: navigation (Open in new tab, Open
   * source) above a single separator, then the item actions in the shared
   * order — Rename, Tags, Enable/Disable, Delete.
   */
  const hasNavigationSection = !isMultiSelect && (!!onOpenInNewTab || !!onOpenSource)
  const hasActionsSection =
    (!isMultiSelect && (!!onRename || !!onViewTags)) || !!onToggleEnabled || !!onDelete

  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {hasDocument ? (
        <>
          {!isMultiSelect && onOpenInNewTab && (
            <DropdownMenuItem onSelect={onOpenInNewTab}>
              <SquareArrowUpRight />
              Open in new tab
            </DropdownMenuItem>
          )}
          {!isMultiSelect && onOpenSource && (
            <DropdownMenuItem onSelect={onOpenSource}>
              <SquareArrowUpRight />
              Open source
            </DropdownMenuItem>
          )}
          {hasNavigationSection && hasActionsSection && <DropdownMenuSeparator />}
          {!isMultiSelect && onRename && (
            <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
          )}
          {!isMultiSelect && onViewTags && (
            <DropdownMenuItem onSelect={onViewTags}>
              <TagIcon />
              Tags
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
        onAddDocument && (
          <DropdownMenuItem disabled={disableAddDocument} onSelect={onAddDocument}>
            <Plus />
            Add document
          </DropdownMenuItem>
        )
      )}
    </AnchoredContextMenu>
  )
}
