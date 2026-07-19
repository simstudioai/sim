'use client'

import { memo } from 'react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@sim/emcn'
import { Duplicate, Pencil, SquareArrowUpRight, TagIcon, Trash } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface KnowledgeBaseContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onViewTags?: () => void
  onCopyId?: () => void
  onEdit?: () => void
  onDelete?: () => void
  showOpenInNewTab?: boolean
  showViewTags?: boolean
  showEdit?: boolean
  showDelete?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
}

/**
 * Context menu for knowledge base cards. Canonical resource-menu structure:
 * navigation (Open in new tab) above a single separator, then the item actions
 * in the shared order — Edit, View tags, utilities, Delete.
 */
export const KnowledgeBaseContextMenu = memo(function KnowledgeBaseContextMenu({
  isOpen,
  position,
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
  const hasNavigationSection = showOpenInNewTab && !!onOpenInNewTab
  const hasActionsSection =
    (showEdit && !!onEdit) ||
    (showViewTags && !!onViewTags) ||
    !!onCopyId ||
    (showDelete && !!onDelete)

  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {hasNavigationSection && (
        <DropdownMenuItem onSelect={onOpenInNewTab!}>
          <SquareArrowUpRight />
          Open in new tab
        </DropdownMenuItem>
      )}
      {hasNavigationSection && hasActionsSection && <DropdownMenuSeparator />}
      {showEdit && onEdit && (
        <DropdownMenuItem disabled={disableEdit} onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
      )}
      {showViewTags && onViewTags && (
        <DropdownMenuItem onSelect={onViewTags}>
          <TagIcon />
          View tags
        </DropdownMenuItem>
      )}
      {onCopyId && (
        <DropdownMenuItem onSelect={onCopyId}>
          <Duplicate />
          Copy ID
        </DropdownMenuItem>
      )}
      {showDelete && onDelete && (
        <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
          <Trash />
          Delete
        </DropdownMenuItem>
      )}
    </AnchoredContextMenu>
  )
})
