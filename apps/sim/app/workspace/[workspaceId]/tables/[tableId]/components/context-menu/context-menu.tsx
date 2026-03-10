import { Popover, PopoverAnchor, PopoverContent } from '@/components/emcn'
import { ArrowDown, ArrowUp, Pencil, Trash } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ContextMenuState } from '../../types'

const MENU_ITEM =
  'relative flex cursor-default select-none items-center gap-[8px] rounded-[5px] px-[8px] py-[5px] font-medium text-[12px] text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--surface-4)] hover:text-[var(--text-primary)] [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0'

const MENU_SEPARATOR = '-mx-[6px] my-[6px] h-px bg-[var(--border-1)]'

interface ContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEditCell: () => void
  onDelete: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  selectedRowCount?: number
}

export function ContextMenu({
  contextMenu,
  onClose,
  onEditCell,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  selectedRowCount = 1,
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
          <div className={MENU_ITEM} onClick={onEditCell} role='menuitem'>
            <Pencil />
            Edit cell
          </div>
        )}
        <div className={MENU_ITEM} onClick={onInsertAbove} role='menuitem'>
          <ArrowUp />
          Insert row above
        </div>
        <div className={MENU_ITEM} onClick={onInsertBelow} role='menuitem'>
          <ArrowDown />
          Insert row below
        </div>
        <div className={MENU_SEPARATOR} role='separator' />
        <div
          className={cn(MENU_ITEM, 'text-[var(--text-error)] hover:text-[var(--text-error)]')}
          onClick={onDelete}
          role='menuitem'
        >
          <Trash />
          {deleteLabel}
        </div>
      </PopoverContent>
    </Popover>
  )
}
