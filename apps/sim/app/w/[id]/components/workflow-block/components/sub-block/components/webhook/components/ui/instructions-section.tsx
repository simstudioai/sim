import React from 'react'
import { Lightbulb } from 'lucide-react'
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
    <div className={cn('bg-card/50 p-4 rounded-md mt-4 border border-border shadow-sm', className)}>
      <h4 className="font-medium text-base mb-3">{title}</h4>
      <div className="text-sm text-muted-foreground space-y-1 [&_a]:text-primary [&_a]:underline [&_a]:hover:text-primary/80 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono">
        {children} {/* Instructions list goes here */}
      </div>
    </div>
  )
}
