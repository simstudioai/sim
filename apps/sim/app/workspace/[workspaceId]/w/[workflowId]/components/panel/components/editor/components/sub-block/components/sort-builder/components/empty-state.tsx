import { Plus } from 'lucide-react'
import { Button } from '@/components/emcn'

interface EmptyStateProps {
  onAdd: () => void
  disabled: boolean
  label: string
}

export function EmptyState({ onAdd, disabled, label }: EmptyStateProps) {
  return (
    <div className='flex items-center justify-center rounded-[4px] border border-[var(--border-1)] border-dashed py-[16px]'>
      <Button variant='ghost' size='sm' onClick={onAdd} disabled={disabled}>
        <Plus className='mr-[4px] h-[12px] w-[12px]' />
        {label}
      </Button>
    </div>
  )
}
