'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Upload,
} from '@sim/emcn'
import { FolderPlus, Plus } from '@sim/emcn/icons'

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
        {/* Import CSV, New folder, New table — the order the page header presents
            them once `orderHeaderActions` has pinned the primary action last. */}
        {onUploadCsv && (
          <DropdownMenuItem disabled={disableUpload} onSelect={onUploadCsv}>
            <Upload />
            Import CSV
          </DropdownMenuItem>
        )}
        {onCreateFolder && (
          <DropdownMenuItem disabled={disableCreateFolder} onSelect={onCreateFolder}>
            <FolderPlus />
            New folder
          </DropdownMenuItem>
        )}
        {onCreateTable && (
          <DropdownMenuItem disabled={disableCreate} onSelect={onCreateTable}>
            <Plus />
            New table
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
