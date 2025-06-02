'use client'

import { LibraryBig } from 'lucide-react'

interface EmptyStateCardProps {
  title: string
  description: string
  buttonText: string
  onClick: () => void
  icon?: React.ReactNode
}

export function EmptyStateCard({
  title,
  description,
  buttonText,
  onClick,
  icon,
}: EmptyStateCardProps) {
  return (
    <div
      onClick={onClick}
      className='group flex cursor-pointer flex-col gap-3 rounded-md border border-muted-foreground/25 border-dashed bg-background p-4 transition-colors hover:border-muted-foreground/40 hover:bg-accent/50'
    >
      <div className='flex items-center gap-2'>
        {icon || <LibraryBig className='h-4 w-4 flex-shrink-0 text-muted-foreground' />}
        <h3 className='truncate font-medium text-sm leading-tight'>{title}</h3>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-2 text-muted-foreground text-xs'>
          <span>Get started</span>
        </div>

        <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>{description}</p>
      </div>
    </div>
  )
}
