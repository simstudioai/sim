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
  Tooltip,
} from '@sim/emcn'
import { Duplicate, Eye, FolderInput, Pencil, Pin, Trash } from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders/move-options'
import { renderMoveOptions } from '@/app/workspace/[workspaceId]/components/folders/move-options'
import { selectionActionLabel } from '@/app/workspace/[workspaceId]/components/resource/selection-label'

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
  canDelete?: boolean
  deleteDisabledReason?: string
  selectedCount: number
}

/**
 * Row context menu for a folder, shared by the resource lists built on the generic folder
 * engine — Knowledge and Tables — so a folder offers the same actions on both.
 *
 * Files is deliberately not a consumer: a folder there routes through `FileRowContextMenu`
 * alongside the file rows it is selected with. Converging the two is follow-up work.
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
  canDelete = canEdit,
  deleteDisabledReason,
  selectedCount,
}: FolderContextMenuProps) {
  const isMultiSelect = selectedCount > 1
  const hasMove = Boolean(onMove && moveOptions && moveOptions.length > 0)
  const hasActionsAboveDestructive = !isMultiSelect || hasMove
  const hasAvailableActions = !isMultiSelect || (canEdit && (hasMove || canDelete))

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
        {!hasAvailableActions ? (
          <DropdownMenuItem disabled>No actions available</DropdownMenuItem>
        ) : (
          <>
            {!isMultiSelect && (
              <>
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
              </>
            )}
            {canEdit && (
              <>
                {!isMultiSelect && (
                  <DropdownMenuItem onSelect={onRename}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                )}
                {hasMove && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderInput />
                      {selectionActionLabel('Move', selectedCount, 'Move to')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {renderMoveOptions(moveOptions!, onMove!)}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {canDelete && (
                  <>
                    {hasActionsAboveDestructive && <DropdownMenuSeparator />}
                    {deleteDisabledReason ? (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <div>
                            <DropdownMenuItem disabled>
                              <Trash />
                              {selectionActionLabel('Delete', selectedCount)}
                            </DropdownMenuItem>
                          </div>
                        </Tooltip.Trigger>
                        <Tooltip.Content>{deleteDisabledReason}</Tooltip.Content>
                      </Tooltip.Root>
                    ) : (
                      <DropdownMenuItem onSelect={onDelete}>
                        <Trash />
                        {selectionActionLabel('Delete', selectedCount)}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
