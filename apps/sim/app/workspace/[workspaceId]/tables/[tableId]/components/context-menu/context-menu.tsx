import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash } from '@/components/emcn/icons'
import type { ContextMenuState } from '../../types'

interface ContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEditCell: () => void
  onAddData: () => void
  onDelete: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  selectedRowCount?: number
}

export function ContextMenu({
  contextMenu,
  onClose,
  onEditCell,
  onAddData,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  selectedRowCount = 1,
}: ContextMenuProps) {
  const isEmptyCell = !contextMenu.row
  const deleteLabel = selectedRowCount > 1 ? `Delete ${selectedRowCount} rows` : 'Delete row'

  return (
    <DropdownMenu open={contextMenu.isOpen} onOpenChange={(open) => !open && onClose()}>
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
      <DropdownMenuContent align='start' side='bottom' sideOffset={4} className='min-w-[160px]'>
        {isEmptyCell ? (
          <DropdownMenuItem onSelect={onAddData}>
            <Plus />
            Add data
          </DropdownMenuItem>
        ) : (
          <>
            {contextMenu.columnName && (
              <DropdownMenuItem onSelect={onEditCell}>
                <Pencil />
                Edit cell
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onInsertAbove}>
              <ArrowUp />
              Insert row above
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onInsertBelow}>
              <ArrowDown />
              Insert row below
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className='text-[var(--text-error)] focus:text-[var(--text-error)]'
              onSelect={onDelete}
            >
              <Trash />
              {deleteLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
