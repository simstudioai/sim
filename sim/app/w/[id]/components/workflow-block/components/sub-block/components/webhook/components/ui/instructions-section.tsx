import React from 'react'
import { Lightbulb } from 'lucide-react'

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
    <div
      className={`bg-muted/50 dark:bg-muted/20 p-4 rounded-md mt-4 border border-border ${className}`}
    >
      <h4 className="font-medium text-base mb-3">{title}</h4>
      <div className="text-sm text-muted-foreground space-y-1">
        {children} {/* Instructions list goes here */}
      </div>
      {tip && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-sm text-muted-foreground flex items-center">
            <Lightbulb className="h-4 w-4 text-yellow-500 dark:text-yellow-400 mr-2 flex-shrink-0" />
            {tip}
          </p>
        </div>
      )}
    </div>
  )
}
