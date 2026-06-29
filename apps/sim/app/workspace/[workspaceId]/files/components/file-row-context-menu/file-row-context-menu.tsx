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
import { Download, Link, Trash } from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/files/move-options'
import { renderMoveOption } from '@/app/workspace/[workspaceId]/files/move-options'

interface FileRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen: () => void
  onDownload?: () => void
  onRename: () => void
  onDelete: () => void
  onMove?: (optionValue: string) => void
  onShare?: () => void
  moveOptions?: MoveOptionNode[]
  canEdit: boolean
  selectedCount: number
}

export const FileRowContextMenu = memo(function FileRowContextMenu({
  isOpen,
  position,
  onClose,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  onMove,
  onShare,
  moveOptions,
  canEdit,
  selectedCount,
}: FileRowContextMenuProps) {
  const isMultiSelect = selectedCount > 1

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
        {onDownload && (
          <DropdownMenuItem onSelect={onDownload}>
            <Download />
            {isMultiSelect ? `Download ${selectedCount} items` : 'Download'}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            {!isMultiSelect && (
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onShare && (
              <DropdownMenuItem onSelect={onShare}>
                <Link />
                Share
              </DropdownMenuItem>
            )}
            {onMove && moveOptions && moveOptions.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput />
                  {isMultiSelect ? `Move ${selectedCount} items` : 'Move to'}
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
            <DropdownMenuItem onSelect={onDelete}>
              <Trash />
              {isMultiSelect ? `Delete ${selectedCount} items` : 'Delete'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
