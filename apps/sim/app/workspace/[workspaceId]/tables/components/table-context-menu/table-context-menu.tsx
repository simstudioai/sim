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
import { selectionActionLabel } from '@/app/workspace/[workspaceId]/components/resource/selection-label'

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
  selectedCount: number
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
  selectedCount,
}: TableContextMenuProps) {
  const isMultiSelect = selectedCount > 1
  const hasMoveAction = !!(onMove && moveOptions && moveOptions.length > 0)

  /**
   * `Move to` needs a NON-EMPTY `moveOptions`, not just the handler — the looser
   * `onMove` alone draws the rule with nothing above it for a table whose other
   * actions are all absent and whose move list is empty.
   *
   * @see `.claude/rules/sim-list-ordering.md` — one rule, before the destructive
   * group, with both sides built from the items' exact render conditions.
   */
  const hasActionsAboveDestructive =
    hasMoveAction ||
    (!isMultiSelect &&
      !!(onViewSchema || onRename || onImportCsv || onExportCsv || onCopyId || onTogglePin))

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
        {!isMultiSelect && onViewSchema && (
          <DropdownMenuItem onSelect={onViewSchema}>
            <Database />
            View Schema
          </DropdownMenuItem>
        )}
        {!isMultiSelect && onRename && (
          <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {!isMultiSelect && onImportCsv && (
          <DropdownMenuItem disabled={disableImport} onSelect={onImportCsv}>
            <Upload />
            Import CSV
          </DropdownMenuItem>
        )}
        {!isMultiSelect && onExportCsv && (
          <DropdownMenuItem disabled={disableExport} onSelect={onExportCsv}>
            <Download />
            Export CSV
          </DropdownMenuItem>
        )}
        {onMove && moveOptions && moveOptions.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              {selectionActionLabel('Move', selectedCount, 'Move to')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {renderMoveOptions(moveOptions, onMove)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {!isMultiSelect && onTogglePin && (
          <DropdownMenuItem onSelect={onTogglePin}>
            <Pin />
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        )}
        {!isMultiSelect && onCopyId && (
          <DropdownMenuItem onSelect={onCopyId}>
            <Duplicate />
            Copy ID
          </DropdownMenuItem>
        )}
        {hasActionsAboveDestructive && onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
            <Trash />
            {selectionActionLabel('Delete', selectedCount)}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
