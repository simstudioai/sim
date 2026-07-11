'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@sim/emcn'
import { FolderPlus, Plus, Upload } from '@sim/emcn/icons'

interface TablesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateTable?: () => void
  onCreateFolder?: () => void
  onUploadCsv?: () => void
  disableCreate?: boolean
  disableCreateFolder?: boolean
  disableUpload?: boolean
}

export function TablesListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateTable,
  onCreateFolder,
  onUploadCsv,
  disableCreate = false,
  disableCreateFolder = false,
  disableUpload = false,
}: TablesListContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          className='pointer-events-none fixed size-px'
          style={{ left: position.x, top: position.y }}
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
        {onCreateTable && (
          <DropdownMenuItem disabled={disableCreate} onSelect={onCreateTable}>
            <Plus />
            Create table
          </DropdownMenuItem>
        )}
        {onCreateFolder && (
          <DropdownMenuItem disabled={disableCreateFolder} onSelect={onCreateFolder}>
            <FolderPlus />
            New folder
          </DropdownMenuItem>
        )}
        {onUploadCsv && (
          <DropdownMenuItem disabled={disableUpload} onSelect={onUploadCsv}>
            <Upload />
            Import CSV
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
