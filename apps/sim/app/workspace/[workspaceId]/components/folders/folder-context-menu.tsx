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
import { Duplicate, Eye, FolderInput, Pencil, Pin, Trash } from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders/move-options'
import { renderMoveOptions } from '@/app/workspace/[workspaceId]/components/folders/move-options'

interface FolderContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onCopyId?: () => void
  onMove?: (optionValue: string) => void
  onTogglePin: () => void
  /** Pin state of the right-clicked folder, driving the Pin/Unpin label. */
  pinned: boolean
  moveOptions?: MoveOptionNode[]
  canEdit: boolean
}

/**
 * Row context menu for a folder, shared across every foldered resource list so a folder
 * offers the same actions on Knowledge, Tables, and Files.
 *
 * Mirrors the resource-row menus (`KnowledgeBaseContextMenu`, `FileRowContextMenu`): a
 * `DropdownMenu` anchored to a one-pixel fixed trigger at the cursor, non-modal so the list
 * behind it stays interactive. Folder locking is deliberately absent — it is a workflow-only
 * feature and is not extended to the other resource trees.
 */
export const FolderContextMenu = memo(function FolderContextMenu({
  isOpen,
  position,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onCopyId,
  onMove,
  onTogglePin,
  pinned,
  moveOptions,
  canEdit,
}: FolderContextMenuProps) {
  const hasMove = Boolean(onMove && moveOptions && moveOptions.length > 0)

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          className='pointer-events-none fixed size-px'
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
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
        <DropdownMenuItem onSelect={onOpen}>
          <Eye />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTogglePin}>
          <Pin />
          {pinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
        {onCopyId && (
          <DropdownMenuItem onSelect={onCopyId}>
            <Duplicate />
            Copy ID
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            {hasMove && (
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
