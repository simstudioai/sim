import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import { ArrowDown, ArrowUp, Pencil, Trash } from '@/components/emcn/icons'
import type { ContextMenuState } from '../../types'

interface ContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEditCell: () => void
  onDelete: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
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
  selectedRowCount = 1,
  disableEdit = false,
  disableInsert = false,
  disableDelete = false,
}: ContextMenuProps) {
  const deleteLabel = selectedRowCount > 1 ? `Delete ${selectedRowCount} rows` : 'Delete row'

  return (
    <Popover open={contextMenu.isOpen} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${contextMenu.position.x}px`,
          top: `${contextMenu.position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent
        align='start'
        side='bottom'
        sideOffset={4}
        border
        className='!min-w-[160px] !rounded-[8px] !bg-[var(--bg)] !p-[6px] shadow-sm'
      >
        {contextMenu.columnName && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onEditCell()
              onClose()
            }}
          >
            <Pencil />
            Edit cell
          </PopoverItem>
        )}
        <PopoverItem
          disabled={disableInsert}
          onClick={() => {
            onInsertAbove()
            onClose()
          }}
        >
          <ArrowUp />
          Insert row above
        </PopoverItem>
        <PopoverItem
          disabled={disableInsert}
          onClick={() => {
            onInsertBelow()
            onClose()
          }}
        >
          <ArrowDown />
          Insert row below
        </PopoverItem>
        <PopoverDivider />
        <PopoverItem
          disabled={disableDelete}
          onClick={() => {
            onDelete()
            onClose()
          }}
          className='text-[var(--text-error)] focus:text-[var(--text-error)]'
        >
          <Trash />
          {deleteLabel}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
