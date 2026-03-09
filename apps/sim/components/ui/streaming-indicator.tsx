'use client'

import { memo } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface StreamingIndicatorProps {
  className?: string
  label?: string
}

export const StreamingIndicator = memo(({ className, label }: StreamingIndicatorProps) => {
  return (
    <div className={cn('flex h-[1.25rem] items-center gap-1.5 text-muted-foreground', className)}>
      <div className='flex space-x-0.5'>
        <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms] [animation-duration:1.2s]' />
        <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms] [animation-duration:1.2s]' />
        <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms] [animation-duration:1.2s]' />
      </div>
      {label && <span className='text-[13px] text-muted-foreground'>{label}</span>}
    </div>
  )
})

StreamingIndicator.displayName = 'StreamingIndicator'
