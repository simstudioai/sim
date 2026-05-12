'use client'

import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { FolderPlus, Plus, Upload } from '@/components/emcn/icons'

interface FilesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateFile?: () => void
  onCreateFolder?: () => void
  onUploadFile?: () => void
  disableCreate?: boolean
  disableCreateFolder?: boolean
  disableUpload?: boolean
}

export const FilesListContextMenu = memo(function FilesListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateFile,
  onCreateFolder,
  onUploadFile,
  disableCreate = false,
  disableCreateFolder = false,
  disableUpload = false,
}: FilesListContextMenuProps) {
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
        {onCreateFile && (
          <DropdownMenuItem disabled={disableCreate} onSelect={onCreateFile}>
            <Plus />
            New file
          </DropdownMenuItem>
        )}
        {onCreateFolder && (
          <DropdownMenuItem disabled={disableCreateFolder} onSelect={onCreateFolder}>
            <FolderPlus />
            New folder
          </DropdownMenuItem>
        )}
        {onUploadFile && (
          <DropdownMenuItem disabled={disableUpload} onSelect={onUploadFile}>
            <Upload />
            Upload file
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
