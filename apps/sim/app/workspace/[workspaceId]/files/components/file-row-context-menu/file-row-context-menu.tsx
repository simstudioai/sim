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
  Eye,
  Folder,
  FolderInput,
  Pencil,
} from '@sim/emcn'
import { Download, Link, Pin, Send, Trash } from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import { renderMoveOption } from '@/app/workspace/[workspaceId]/components/folders'
import { selectionActionLabel } from '@/app/workspace/[workspaceId]/components/resource/selection-label'

interface FileRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen: () => void
  onCopyLink?: () => void
  onDownload?: () => void
  onRename: () => void
  onDelete: () => void
  onMove?: (optionValue: string) => void
  onShare?: () => void
  onTogglePin: () => void
  /** Pin state of the right-clicked row, driving the Pin/Unpin label. */
  pinned: boolean
  moveOptions?: MoveOptionNode[]
  canEdit: boolean
  selectedCount: number
}

export const FileRowContextMenu = memo(function FileRowContextMenu({
  isOpen,
  position,
  onClose,
  onOpen,
  onCopyLink,
  onDownload,
  onRename,
  onDelete,
  onMove,
  onShare,
  onTogglePin,
  pinned,
  moveOptions,
  canEdit,
  selectedCount,
}: FileRowContextMenuProps) {
  const isMultiSelect = selectedCount > 1

  /**
   * Everything that can render above `Delete`: Open/Pin need a single selection,
   * Download needs its handler, and the edit trio needs `canEdit` — so a multi-select
   * with no download and only a move target leaves `Move to` alone above the rule.
   *
   * @see `.claude/rules/sim-list-ordering.md` — one rule, before the destructive group.
   */
  const hasActionsAboveDestructive =
    !isMultiSelect || !!onDownload || (!!onMove && !!moveOptions && moveOptions.length > 0)

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          className='pointer-events-none fixed h-px w-px'
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
        {!isMultiSelect && (
          <DropdownMenuItem onSelect={onOpen}>
            <Eye />
            Open
          </DropdownMenuItem>
        )}
        {!isMultiSelect && onCopyLink && (
          <DropdownMenuItem onSelect={onCopyLink}>
            <Link />
            Copy Link
          </DropdownMenuItem>
        )}
        {onDownload && (
          <DropdownMenuItem onSelect={onDownload}>
            <Download />
            {selectionActionLabel('Download', selectedCount)}
          </DropdownMenuItem>
        )}
        {!isMultiSelect && (
          <DropdownMenuItem onSelect={onTogglePin}>
            <Pin />
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            {!isMultiSelect && (
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onShare && (
              <DropdownMenuItem onSelect={onShare}>
                <Send />
                Share
              </DropdownMenuItem>
            )}
            {onMove && moveOptions && moveOptions.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput />
                  {selectionActionLabel('Move', selectedCount, 'Move to')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => onMove(moveOptions[0].value)}>
                    <Folder />
                    {moveOptions[0].label}
                  </DropdownMenuItem>
                  {moveOptions.length > 1 && <DropdownMenuSeparator />}
                  {moveOptions.slice(1).map((option) => renderMoveOption(option, onMove))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {hasActionsAboveDestructive && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={onDelete}>
              <Trash />
              {selectionActionLabel('Delete', selectedCount)}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
