'use client'

import { Plus, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TriggerPlaceholderProps {
  onClick: () => void
  className?: string
}

export function TriggerPlaceholder({ onClick, className }: TriggerPlaceholderProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center',
        className
      )}
    >
      <button
        onClick={onClick}
        className={cn(
          'group pointer-events-auto relative',
          'h-32 w-64 rounded-xl',
          'border-2 border-muted-foreground/30 border-dashed',
          'bg-background/50 backdrop-blur-sm',
          'transition-all duration-300 ease-out',
          'hover:border-foreground/50 hover:bg-background/80',
          'hover:scale-[1.02] hover:shadow-lg',
          'active:scale-[0.98]',
          'cursor-pointer'
        )}
      >
        <div className='flex h-full flex-col items-center justify-center px-4'>
          <div className='relative mb-2'>
            <Zap className='h-8 w-8 text-muted-foreground transition-colors duration-300 group-hover:text-foreground' />
            <Plus className='-bottom-1 -right-1 absolute h-4 w-4 text-muted-foreground opacity-0 transition-all duration-300 group-hover:text-foreground group-hover:opacity-100' />
          </div>

          <p className='font-medium text-muted-foreground text-sm transition-colors group-hover:text-foreground'>
            Click to Add Trigger
          </p>
        </div>
      </button>
    </div>
  )
}
