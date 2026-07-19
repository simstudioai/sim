'use client'

import { DropdownMenuItem, Upload } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

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
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {onCreateTable && (
        <DropdownMenuItem disabled={disableCreate} onSelect={onCreateTable}>
          <Plus />
          Create table
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
