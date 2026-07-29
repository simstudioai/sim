'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Upload,
} from '@sim/emcn'
import { Database, Download, Duplicate, FolderInput, Pencil, Pin, Trash } from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import { renderMoveOptions } from '@/app/workspace/[workspaceId]/components/folders'

interface TableContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCopyId?: () => void
  onTogglePin?: () => void
  /** Pin state of the right-clicked table, driving the Pin/Unpin label. */
  pinned?: boolean
  onDelete?: () => void
  onViewSchema?: () => void
  onRename?: () => void
  onImportCsv?: () => void
  onExportCsv?: () => void
  /** Files the table under another folder; the value is a folder id or the root sentinel. */
  onMove?: (optionValue: string) => void
  moveOptions?: MoveOptionNode[]
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
  onTogglePin,
  pinned = false,
  onDelete,
  onViewSchema,
  onRename,
  onImportCsv,
  onExportCsv,
  onMove,
  moveOptions,
  disableDelete = false,
  disableRename = false,
  disableImport = false,
  disableExport = false,
}: TableContextMenuProps) {
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
        {onViewSchema && (
          <DropdownMenuItem onSelect={onViewSchema}>
            <Database />
            View Schema
          </DropdownMenuItem>
        )}
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
        {onMove && moveOptions && moveOptions.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {renderMoveOptions(moveOptions, onMove)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {(onViewSchema || onRename || onImportCsv || onExportCsv || onMove) &&
          (onCopyId || onTogglePin || onDelete) && <DropdownMenuSeparator />}
        {onTogglePin && (
          <DropdownMenuItem onSelect={onTogglePin}>
            <Pin />
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        )}
        {onCopyId && (
          <DropdownMenuItem onSelect={onCopyId}>
            <Duplicate />
            Copy ID
          </DropdownMenuItem>
        )}
        {(onCopyId || onTogglePin) && onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
            <Trash />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
