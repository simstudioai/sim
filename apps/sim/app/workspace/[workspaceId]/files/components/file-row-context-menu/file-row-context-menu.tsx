'use client'

import { memo } from 'react'
import { FolderInput } from 'lucide-react'
import {
  Download,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Eye,
  Pencil,
  Trash2,
} from '@/components/emcn'
import { Folder } from '@/components/emcn/icons'

interface MoveOption {
  value: string
  label: string
}

interface FileRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen: () => void
  onDownload?: () => void
  onRename: () => void
  onDelete: () => void
  onMove?: (optionValue: string) => void
  moveOptions?: MoveOption[]
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
  moveOptions,
  canEdit,
  selectedCount,
}: FileRowContextMenuProps) {
  const isMultiSelect = selectedCount > 1

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
            {onMove && moveOptions && moveOptions.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput />
                  {isMultiSelect ? `Move ${selectedCount} items` : 'Move to'}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {moveOptions.map((option) => (
                    <DropdownMenuItem key={option.value} onSelect={() => onMove(option.value)}>
                      <Folder />
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onSelect={onDelete}>
              <Trash2 />
              {isMultiSelect ? `Delete ${selectedCount} items` : 'Delete'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
