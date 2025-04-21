'use client'

import { cn } from '@/lib/utils'

interface DeployStatusProps {
  needsRedeployment: boolean
}

export function DeployStatus({ needsRedeployment }: DeployStatusProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Status:</span>
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center justify-center">
          {needsRedeployment ? (
            <>
              <div className="absolute h-3 w-3 rounded-full bg-amber-500/20 animate-ping"></div>
              <div className="relative h-2 w-2 rounded-full bg-amber-500"></div>
            </>
          ) : (
            <>
              <div className="absolute h-3 w-3 rounded-full bg-green-500/20 animate-ping"></div>
              <div className="relative h-2 w-2 rounded-full bg-green-500"></div>
            </>
          )}
        </div>
        <span
          className={cn(
            'text-xs font-medium',
            needsRedeployment
              ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400'
              : 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
          )}
        >
          {needsRedeployment ? 'Changes Detected' : 'Active'}
        </span>
      </div>
    </div>
  )
}
