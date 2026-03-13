'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Plus, Upload } from '@/components/emcn/icons'

interface FilesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateFile?: () => void
  onUploadFile?: () => void
  disableCreate?: boolean
  disableUpload?: boolean
}

export function FilesListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateFile,
  onUploadFile,
  disableCreate = false,
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
        {onUploadFile && (
          <DropdownMenuItem disabled={disableUpload} onSelect={onUploadFile}>
            <Upload />
            Upload file
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
