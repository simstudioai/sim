'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Upload,
} from '@/components/emcn'
import { Plus } from '@/components/emcn/icons'

interface TablesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateTable?: () => void
  onUploadCsv?: () => void
  disableCreate?: boolean
  disableUpload?: boolean
}

export function TablesListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateTable,
  onUploadCsv,
  disableCreate = false,
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
        {onCreateTable && (
          <DropdownMenuItem disabled={disableCreate} onSelect={onCreateTable}>
            <Plus />
            Create table
          </DropdownMenuItem>
        )}
        {onUploadCsv && (
          <DropdownMenuItem disabled={disableUpload} onSelect={onUploadCsv}>
            <Upload />
            Upload CSV
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
