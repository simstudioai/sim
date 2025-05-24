'use client'

import { cn } from '@/lib/utils'

interface DeployStatusProps {
  needsRedeployment: boolean
}

export function DeployStatus({ needsRedeployment }: DeployStatusProps) {
  return (
    <div className='flex items-center gap-2'>
      <span className='font-medium text-muted-foreground text-xs'>Status:</span>
      <div className='flex items-center gap-1.5'>
        <div className='relative flex items-center justify-center'>
          {needsRedeployment ? (
            <>
              <div className='absolute h-3 w-3 animate-ping rounded-full bg-amber-500/20' />
              <div className='relative h-2 w-2 rounded-full bg-amber-500' />
            </>
          ) : (
            <>
              <div className='absolute h-3 w-3 animate-ping rounded-full bg-green-500/20' />
              <div className='relative h-2 w-2 rounded-full bg-green-500' />
            </>
          )}
        </div>
        <span
          className={cn(
            'font-medium text-xs',
            needsRedeployment
              ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
              : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
          )}
        >
          {needsRedeployment ? 'Changes Detected' : 'Active'}
        </span>
      </div>
    </div>
  )
}
