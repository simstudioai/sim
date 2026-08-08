'use client'

import { DropdownMenuItem, Upload } from '@sim/emcn'
import { FolderPlus, Plus } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

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
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
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
    </AnchoredContextMenu>
  )
}
