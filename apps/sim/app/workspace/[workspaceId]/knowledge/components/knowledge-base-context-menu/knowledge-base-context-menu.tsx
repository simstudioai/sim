'use client'

import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import {
  Duplicate,
  FolderInput,
  Pencil,
  Pin,
  SquareArrowUpRight,
  TagIcon,
  Trash,
} from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import { renderMoveOptions } from '@/app/workspace/[workspaceId]/components/folders'

interface KnowledgeBaseContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onViewTags?: () => void
  onCopyId?: () => void
  onTogglePin?: () => void
  /** Pin state of the right-clicked base, driving the Pin/Unpin label. */
  pinned?: boolean
  onEdit?: () => void
  onDelete?: () => void
  /** Files the base under another folder; the value is a folder id or the root sentinel. */
  onMove?: (optionValue: string) => void
  moveOptions?: MoveOptionNode[]
  showOpenInNewTab?: boolean
  showViewTags?: boolean
  showEdit?: boolean
  showDelete?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
}

/**
 * Context menu component for knowledge base cards.
 * Displays open in new tab, view tags, edit, and delete options.
 */
export const KnowledgeBaseContextMenu = memo(function KnowledgeBaseContextMenu({
  isOpen,
  position,
  onClose,
  onOpenInNewTab,
  onViewTags,
  onCopyId,
  onTogglePin,
  pinned = false,
  onEdit,
  onDelete,
  onMove,
  moveOptions,
  showOpenInNewTab = true,
  showViewTags = true,
  showEdit = true,
  showDelete = true,
  disableEdit = false,
  disableDelete = false,
}: KnowledgeBaseContextMenuProps) {
  const hasNavigationSection = showOpenInNewTab && !!onOpenInNewTab
  const hasInfoSection = (showViewTags && !!onViewTags) || !!onCopyId || !!onTogglePin
  const hasMoveSection = !disableEdit && !!onMove && !!moveOptions && moveOptions.length > 0
  const hasEditSection = (showEdit && !!onEdit) || hasMoveSection
  const hasDestructiveSection = showDelete && !!onDelete

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {hasNavigationSection && (
          <DropdownMenuItem onSelect={onOpenInNewTab!}>
            <SquareArrowUpRight />
            Open in new tab
          </DropdownMenuItem>
        )}
        {hasNavigationSection && (hasInfoSection || hasEditSection || hasDestructiveSection) && (
          <DropdownMenuSeparator />
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
        {onTogglePin && (
          <DropdownMenuItem onSelect={onTogglePin}>
            <Pin />
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        )}
        {hasInfoSection && (hasEditSection || hasDestructiveSection) && <DropdownMenuSeparator />}

        {showEdit && onEdit && (
          <DropdownMenuItem disabled={disableEdit} onSelect={onEdit}>
            <Pencil />
            Edit
          </DropdownMenuItem>
        )}

        {hasMoveSection && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {renderMoveOptions(moveOptions!, onMove!)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {hasEditSection && hasDestructiveSection && <DropdownMenuSeparator />}
        {showDelete && onDelete && (
          <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
            <Trash />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
