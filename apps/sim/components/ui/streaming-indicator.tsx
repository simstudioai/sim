'use client'

import { memo } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface StreamingIndicatorProps {
  className?: string
  variant?: 'dots' | 'pulse'
  label?: string
}

export const StreamingIndicator = memo(
  ({ className, variant = 'dots', label }: StreamingIndicatorProps) => {
    if (variant === 'pulse') {
      return (
        <div className={cn('flex items-center gap-[6px] py-[8px]', className)}>
          <div className='h-[6px] w-[6px] animate-pulse rounded-full bg-[var(--text-tertiary)]' />
          {label && (
            <span className='font-base text-[13px] text-[var(--text-tertiary)]'>{label}</span>
          )}
        </div>
      )
    }

    return (
      <div className={cn('flex h-[1.25rem] items-center text-muted-foreground', className)}>
        <div className='flex space-x-0.5'>
          <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms] [animation-duration:1.2s]' />
          <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms] [animation-duration:1.2s]' />
          <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms] [animation-duration:1.2s]' />
        </div>
      </div>
    )
  }
)

StreamingIndicator.displayName = 'StreamingIndicator'
