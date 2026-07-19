'use client'

import { DropdownMenuItem, DropdownMenuSeparator, Upload } from '@sim/emcn'
import { Database, Download, Duplicate, Pencil, Trash } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface TableContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCopyId?: () => void
  onDelete?: () => void
  onViewSchema?: () => void
  onRename?: () => void
  onImportCsv?: () => void
  onExportCsv?: () => void
  disableDelete?: boolean
  disableRename?: boolean
  disableImport?: boolean
  disableExport?: boolean
  menuRef?: React.RefObject<HTMLDivElement | null>
}

export function TableContextMenu({
  isOpen,
  position,
  onClose,
  onCopyId,
  onDelete,
  onViewSchema,
  onRename,
  onImportCsv,
  onExportCsv,
  disableDelete = false,
  disableRename = false,
  disableImport = false,
  disableExport = false,
}: TableContextMenuProps) {
  /**
   * Canonical resource-menu structure: navigation (View Schema) above a single
   * separator, then the item actions in the shared order — Rename, Import,
   * Export, utilities, Delete.
   */
  const hasActionsSection = !!onRename || !!onImportCsv || !!onExportCsv || !!onCopyId || !!onDelete

  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {onViewSchema && (
        <DropdownMenuItem onSelect={onViewSchema}>
          <Database />
          View Schema
        </DropdownMenuItem>
      )}
      {onViewSchema && hasActionsSection && <DropdownMenuSeparator />}
      {onRename && (
        <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
      )}
      {onImportCsv && (
        <DropdownMenuItem disabled={disableImport} onSelect={onImportCsv}>
          <Upload />
          Import CSV…
        </DropdownMenuItem>
      )}
      {onExportCsv && (
        <DropdownMenuItem disabled={disableExport} onSelect={onExportCsv}>
          <Download />
          Export CSV
        </DropdownMenuItem>
      )}
      {onCopyId && (
        <DropdownMenuItem onSelect={onCopyId}>
          <Duplicate />
          Copy ID
        </DropdownMenuItem>
      )}
      {onDelete && (
        <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
          <Trash />
          Delete
        </DropdownMenuItem>
      )}
    </AnchoredContextMenu>
  )
}
