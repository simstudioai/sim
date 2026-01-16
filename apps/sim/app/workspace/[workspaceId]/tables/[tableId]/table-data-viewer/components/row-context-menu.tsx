import { Edit, Trash2 } from 'lucide-react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import type { ContextMenuState } from '../types'

interface RowContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export function RowContextMenu({ contextMenu, onClose, onEdit, onDelete }: RowContextMenuProps) {
  return (
    <Popover
      open={contextMenu.isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${contextMenu.position.x}px`,
          top: `${contextMenu.position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent align='start' side='bottom' sideOffset={4}>
        <PopoverItem onClick={onEdit}>
          <Edit className='mr-[8px] h-[12px] w-[12px]' />
          Edit row
        </PopoverItem>
        <PopoverDivider />
        <PopoverItem onClick={onDelete} className='text-[var(--text-error)]'>
          <Trash2 className='mr-[8px] h-[12px] w-[12px]' />
          Delete row
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
