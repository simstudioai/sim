import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { ArrowDown, ArrowUp, Duplicate, Pencil, Trash } from '@/components/emcn/icons'
import type { ContextMenuState } from '../../types'

interface ContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEditCell: () => void
  onDelete: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDuplicate: () => void
  selectedRowCount?: number
  disableEdit?: boolean
  disableInsert?: boolean
  disableDelete?: boolean
}

export function ContextMenu({
  contextMenu,
  onClose,
  onEditCell,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onDuplicate,
  selectedRowCount = 1,
  disableEdit = false,
  disableInsert = false,
  disableDelete = false,
}: ContextMenuProps) {
  const deleteLabel = selectedRowCount > 1 ? `Delete ${selectedRowCount} rows` : 'Delete row'

  return (
    <DropdownMenu
      open={contextMenu.isOpen}
      onOpenChange={(open) => !open && onClose()}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${contextMenu.position.x}px`,
            top: `${contextMenu.position.y}px`,
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
        {contextMenu.columnName && (
          <DropdownMenuItem disabled={disableEdit} onSelect={onEditCell}>
            <Pencil />
            Edit cell
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={disableInsert} onSelect={onInsertAbove}>
          <ArrowUp />
          Insert row above
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disableInsert} onSelect={onInsertBelow}>
          <ArrowDown />
          Insert row below
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disableInsert || selectedRowCount > 1} onSelect={onDuplicate}>
          <Duplicate />
          Duplicate row
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
          <Trash />
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
