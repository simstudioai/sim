import type React from 'react'
import { cn } from '@/lib/utils'

interface InstructionsSectionProps {
  title?: string
  children: React.ReactNode
  tip?: string
  className?: string
}

export function InstructionsSection({
  title = 'Setup Instructions',
  children,
  tip,
  className,
}: InstructionsSectionProps) {
  return (
    <div className={cn('mt-4 rounded-md border border-border bg-card p-4 shadow-sm', className)}>
      <h4 className='mb-3 font-medium text-base'>{title}</h4>
      <div className='space-y-1 text-muted-foreground text-sm [&_a]:text-foreground [&_a]:underline [&_a]:hover:text-foreground/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs'>
        {children} {/* Instructions list goes here */}
      </div>
    </div>
  )
}
