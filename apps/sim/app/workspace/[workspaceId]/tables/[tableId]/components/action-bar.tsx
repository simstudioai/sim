'use client'

import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/emcn'

interface ActionBarProps {
  selectedCount: number
  onDelete: () => void
  onClearSelection: () => void
}

export function ActionBar({ selectedCount, onDelete, onClearSelection }: ActionBarProps) {
  return (
    <div className='flex h-[36px] shrink-0 items-center justify-between border-[var(--border)] border-b bg-[var(--surface-4)] px-[16px]'>
      <div className='flex items-center gap-[12px]'>
        <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
          {selectedCount} {selectedCount === 1 ? 'row' : 'rows'} selected
        </span>
        <Button variant='ghost' size='sm' onClick={onClearSelection}>
          <X className='mr-[4px] h-[10px] w-[10px]' />
          Clear
        </Button>
      </div>

      <Button variant='destructive' size='sm' onClick={onDelete}>
        <Trash2 className='mr-[4px] h-[10px] w-[10px]' />
        Delete
      </Button>
    </div>
  )
}
